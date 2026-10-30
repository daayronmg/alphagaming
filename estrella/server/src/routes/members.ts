import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { q, one, tx, audit, type Db } from '../db.ts';
import { h, parse, HttpError } from '../lib/http.ts';
import {
  requireAuth, requirePerm, can, sectionsWith, isStaff, hashPassword, randomToken, sha256, GLOBAL_PERMISSIONS,
  forgetSession, forgetUser,
} from '../lib/auth.ts';
import { upload } from '../lib/files.ts';
import { parseCsv, toCsv, norm } from '../lib/csv.ts';
import { config } from '../config.ts';
import { hub } from '../realtime.ts';

export const membersRouter = Router();
membersRouter.use(requireAuth);

export interface Assignment {
  id: number; instrument_id: number; instrument: string; voice_id: number | null; voice: string | null;
  section_id: number; section: string; is_default: boolean; clef: string; transposition: number;
}

export async function userAssignments(userId: string, db?: Db): Promise<Assignment[]> {
  return q<Assignment>(`select a.id, a.instrument_id, i.name as instrument, a.voice_id, v.name as voice, i.section_id, s.name as section,
      a.is_default, i.clef, i.transposition
    from user_assignments a join instruments i on i.id = a.instrument_id join sections s on s.id = i.section_id
    left join voices v on v.id = a.voice_id where a.user_id = $1 order by a.is_default desc, s.sort, i.sort, v.sort`, [userId], db);
}

/** Aplica los cambios de asignación pendientes cuya fecha de efecto ya ha llegado. */
export async function applyDueAssignmentChanges() {
  const due = await q<any>(`select id from assignment_changes where status = 'pendiente' and effective_from is not null and effective_from <= current_date`);
  for (const d of due) await applyAssignmentChange(d.id, null);
}

async function applyAssignmentChange(changeId: number, appliedBy: string | null) {
  await tx(async (c) => {
    const ch = await one<any>(`select * from assignment_changes where id = $1 and status = 'pendiente' for update`, [changeId], c);
    if (!ch) throw new HttpError(404, 'Cambio no encontrado o ya aplicado.');
    await q('delete from user_assignments where user_id = $1', [ch.user_id], c);
    for (const a of ch.after as any[]) {
      await q('insert into user_assignments(user_id, instrument_id, voice_id, is_default) values ($1,$2,$3,$4)', [ch.user_id, a.instrument_id, a.voice_id ?? null, !!a.is_default], c);
    }
    await q(`update assignment_changes set status = 'aplicado', applied_by = $2, applied_at = now() where id = $1`, [changeId, appliedBy], c);
    await audit(appliedBy, 'apply_assignment', 'user', ch.user_id, { before: ch.before, after: ch.after }, c);
    hub.toUser(ch.user_id, { t: 'me:changed' });
  });
}

/** Qué puede ver el usuario actual de cada ficha. */
function contactVisible(viewer: Express.Request['user'], m: { id: string; share_contact: boolean; section_ids: number[] }) {
  if (!viewer) return false;
  if (viewer.id === m.id || viewer.role === 'director' || viewer.permissions.includes('members.manage')) return true;
  const secs = sectionsWith(viewer, 'members');
  if (secs !== 'all' && m.section_ids.some((s) => secs.includes(s))) return true;
  return m.share_contact;
}

membersRouter.get('/', h(async (req, res) => {
  const includeInactive = req.query.all === '1' && (can(req.user, 'members.manage') || isStaff(req.user));
  const rows = await q<any>(`
    select u.id, u.name, u.email, u.role, u.status, u.joined_at, u.photo_file_id, u.phone, u.share_contact, u.is_demo, u.permissions, u.last_login_at,
      coalesce(json_agg(json_build_object('id', a.id, 'instrument_id', a.instrument_id, 'instrument', i.name, 'voice_id', a.voice_id, 'voice', v.name,
        'section_id', i.section_id, 'section', s.name, 'is_default', a.is_default) order by a.is_default desc) filter (where a.id is not null), '[]') as assignments,
      coalesce(array_agg(distinct i.section_id) filter (where i.section_id is not null), '{}') as section_ids,
      (select json_agg(json_build_object('section_id', l.section_id, 'permissions', l.permissions)) from section_leaders l where l.user_id = u.id) as leader_of
    from users u
    left join user_assignments a on a.user_id = u.id
    left join instruments i on i.id = a.instrument_id
    left join sections s on s.id = i.section_id
    left join voices v on v.id = a.voice_id
    where ($1 or u.status = 'active')
    group by u.id order by u.name`, [includeInactive]);
  const viewer = req.user!;
  const manage = can(viewer, 'members.manage');
  res.json(rows.map((m) => {
    const show = contactVisible(viewer, m);
    return {
      id: m.id, name: m.name, role: m.role, status: m.status, joined_at: m.joined_at, photo_file_id: m.photo_file_id, is_demo: m.is_demo,
      assignments: m.assignments, section_ids: m.section_ids, leader_of: m.leader_of ?? [],
      email: show ? m.email : null, phone: show ? m.phone : null,
      ...(manage ? { permissions: m.permissions, last_login_at: m.last_login_at } : {}),
    };
  }));
}));

membersRouter.get('/:id', h(async (req, res) => {
  const m = await one<any>(`select u.*, coalesce((select array_agg(distinct i.section_id) from user_assignments a join instruments i on i.id = a.instrument_id where a.user_id = u.id), '{}') as section_ids from users u where u.id = $1`, [req.params.id]);
  if (!m) throw new HttpError(404, 'Componente no encontrado.');
  const viewer = req.user!;
  const show = contactVisible(viewer, m);
  const manage = can(viewer, 'members.manage');
  const secs = sectionsWith(viewer, 'members');
  const staffOfSection = secs === 'all' || m.section_ids.some((s: number) => secs.includes(s));
  const self = viewer.id === m.id;
  const out: any = {
    id: m.id, name: m.name, role: m.role, status: m.status, joined_at: m.joined_at, photo_file_id: m.photo_file_id, is_demo: m.is_demo,
    email: show ? m.email : null, phone: show ? m.phone : null, share_contact: m.share_contact,
    assignments: await userAssignments(m.id),
    leader_of: await q('select section_id, permissions from section_leaders where user_id = $1', [m.id]),
  };
  if (self || manage || staffOfSection) {
    out.attendance = await one(`select count(*) filter (where status='presente') as presente, count(*) filter (where status='retraso') as retraso,
      count(*) filter (where status='ausente') as ausente, count(*) filter (where status='justificada') as justificada, count(*) as total
      from attendance where user_id = $1`, [m.id]);
    out.courses = await q(`select c.title, count(l.id) as lessons, count(p.completed_at) as done from courses c join lessons l on l.course_id = c.id and l.status='publicado'
      left join lesson_progress p on p.lesson_id = l.id and p.user_id = $1 where c.status='publicado' group by c.id order by c.level, c.sort`, [m.id]);
    out.repertoire = await q(`select distinct ma.id, ma.title from material_usage u join marchas ma on ma.id::text = u.ref_id where u.user_id = $1 and u.kind = 'marcha' limit 50`, [m.id]);
    out.assignment_changes = await q(`select c.*, r.name as requested_by_name from assignment_changes c left join users r on r.id = c.requested_by where c.user_id = $1 order by c.created_at desc limit 20`, [m.id]);
  }
  if (manage) {
    out.permissions = m.permissions;
    out.private_notes = (await one<any>('select notes, updated_at from user_private_notes where user_id = $1', [m.id])) ?? { notes: '' };
    out.last_login_at = m.last_login_at;
    out.left_at = m.left_at;
  }
  res.json(out);
}));

const memberBody = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  role: z.enum(['leader', 'member']).default('member'),
  status: z.enum(['active', 'inactive', 'baja']).default('inactive'),
  joined_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  permissions: z.array(z.enum(Object.keys(GLOBAL_PERMISSIONS) as [string, ...string[]])).default([]),
  assignments: z.array(z.object({ instrument_id: z.number().int(), voice_id: z.number().int().nullable().optional(), is_default: z.boolean().optional() })).max(6).default([]),
});

function normalizeAssignments(list: { instrument_id: number; voice_id?: number | null; is_default?: boolean }[]) {
  const out = list.map((a) => ({ instrument_id: a.instrument_id, voice_id: a.voice_id ?? null, is_default: !!a.is_default }));
  if (out.length && !out.some((a) => a.is_default)) out[0].is_default = true;
  let seen = false;
  for (const a of out) { if (a.is_default) { if (seen) a.is_default = false; seen = true; } }
  return out;
}

async function checkVoiceBelongs(list: { instrument_id: number; voice_id: number | null }[], db?: Db) {
  for (const a of list) {
    if (a.voice_id == null) continue;
    const ok = await one('select 1 from voices where id = $1 and instrument_id = $2', [a.voice_id, a.instrument_id], db);
    if (!ok) throw new HttpError(400, 'La voz seleccionada no pertenece a ese instrumento.');
  }
}

/** Crea una invitación vinculada al correo para que la persona establezca su propia contraseña. */
async function inviteFor(userId: string, email: string, createdBy: string, db?: Db) {
  const code = randomToken(12);
  await q(`insert into invitations(code, email, role, created_by, expires_at) select $1, $2, role, $3, now() + interval '30 days' from users where id = $4`, [code, email, createdBy, userId], db);
  return { code, link: `${config.publicUrl}/registro?codigo=${code}` };
}

membersRouter.post('/', requirePerm('members.manage'), h(async (req, res) => {
  const b = parse(memberBody, req.body);
  const assignments = normalizeAssignments(b.assignments);
  const r = await tx(async (c) => {
    await checkVoiceBelongs(assignments, c);
    // Contraseña aleatoria inutilizable: la persona activa su cuenta con la invitación
    const u = await one<any>(`insert into users(email, password_hash, name, role, status, joined_at, phone, permissions) values (lower($1),$2,$3,$4,$5,$6,$7,$8) returning id`,
      [b.email, hashPassword(randomToken()), b.name, b.role, b.status, b.joined_at ?? null, b.phone ?? null, b.permissions], c);
    for (const a of assignments) await q('insert into user_assignments(user_id, instrument_id, voice_id, is_default) values ($1,$2,$3,$4)', [u.id, a.instrument_id, a.voice_id, a.is_default], c);
    await q(`insert into assignment_changes(user_id, before, after, status, reason, requested_by, applied_by, applied_at) values ($1,'[]',$2,'aplicado','Alta',$3,$3,now())`, [u.id, JSON.stringify(assignments), req.user!.id], c);
    const inv = await inviteFor(u.id, b.email, req.user!.id, c);
    await audit(req.user!.id, 'create', 'user', u.id, { ...b }, c);
    return { id: u.id, invitation: inv };
  });
  res.json(r);
}));

membersRouter.put('/:id', requirePerm('members.manage'), h(async (req, res) => {
  const b = parse(memberBody.omit({ assignments: true }).partial(), req.body);
  const target = await one<any>('select role from users where id = $1', [req.params.id]);
  if (!target) throw new HttpError(404, 'Componente no encontrado.');
  if (target.role === 'director' && req.user!.role !== 'director') throw new HttpError(403, 'Solo la dirección puede modificar la ficha de dirección.');
  if (b.permissions && req.user!.role !== 'director') throw new HttpError(403, 'Solo la dirección concede permisos especiales.');
  await q(`update users set name = coalesce($2,name), email = coalesce(lower($3),email), role = case when role = 'director' then role else coalesce($4,role) end,
      status = coalesce($5,status), joined_at = coalesce($6,joined_at), phone = coalesce($7,phone), permissions = coalesce($8,permissions),
      left_at = case when $5 = 'baja' then coalesce(left_at, current_date) when $5 is not null then null else left_at end
    where id = $1`, [req.params.id, b.name ?? null, b.email ?? null, b.role ?? null, b.status ?? null, b.joined_at ?? null, b.phone ?? null, b.permissions ?? null]);
  if (b.status && b.status !== 'active') await q('delete from sessions where user_id = $1', [req.params.id]);
  forgetUser(req.params.id);
  await audit(req.user!.id, 'update', 'user', req.params.id, b);
  hub.toUser(req.params.id, { t: 'me:changed' });
  res.json({ ok: true });
}));

membersRouter.put('/:id/notes', requirePerm('members.manage'), h(async (req, res) => {
  const { notes } = parse(z.object({ notes: z.string().max(5000) }), req.body);
  await q(`insert into user_private_notes(user_id, notes, updated_by, updated_at) values ($1,$2,$3,now())
    on conflict (user_id) do update set notes = excluded.notes, updated_by = excluded.updated_by, updated_at = now()`, [req.params.id, notes, req.user!.id]);
  res.json({ ok: true });
}));

// Cambio de asignación musical oficial: queda registrado y se aplica al confirmarlo o en la fecha indicada
membersRouter.post('/:id/assignments', requirePerm('assignments.manage'), h(async (req, res) => {
  const b = parse(z.object({
    assignments: memberBody.shape.assignments,
    apply: z.enum(['ahora', 'fecha', 'confirmar']).default('ahora'),
    effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    reason: z.string().max(300).optional(),
  }), req.body);
  const after = normalizeAssignments(b.assignments);
  await checkVoiceBelongs(after);
  const before = (await userAssignments(req.params.id)).map((a) => ({ instrument_id: a.instrument_id, voice_id: a.voice_id, is_default: a.is_default }));
  await q(`update assignment_changes set status = 'cancelado' where user_id = $1 and status = 'pendiente'`, [req.params.id]);
  const ch = await one<any>(`insert into assignment_changes(user_id, before, after, effective_from, reason, requested_by) values ($1,$2,$3,$4,$5,$6) returning id`,
    [req.params.id, JSON.stringify(before), JSON.stringify(after), b.apply === 'fecha' ? b.effective_from : null, b.reason ?? null, req.user!.id]);
  if (b.apply === 'ahora') await applyAssignmentChange(ch.id, req.user!.id);
  else if (b.apply === 'fecha') await applyDueAssignmentChanges();
  res.json({ ok: true, change_id: ch.id });
}));
membersRouter.post('/assignment-changes/:changeId/apply', requirePerm('assignments.manage'), h(async (req, res) => {
  await applyAssignmentChange(Number(req.params.changeId), req.user!.id);
  res.json({ ok: true });
}));
membersRouter.post('/assignment-changes/:changeId/cancel', requirePerm('assignments.manage'), h(async (req, res) => {
  await q(`update assignment_changes set status = 'cancelado' where id = $1 and status = 'pendiente'`, [req.params.changeId]);
  res.json({ ok: true });
}));

membersRouter.post('/:id/invitation', requirePerm('members.manage'), h(async (req, res) => {
  const u = await one<any>('select email, status from users where id = $1', [req.params.id]);
  if (!u) throw new HttpError(404, 'Componente no encontrado.');
  if (u.status === 'baja') throw new HttpError(400, 'La ficha está dada de baja.');
  res.json(await inviteFor(req.params.id, u.email, req.user!.id));
}));

// Enlace de restablecimiento generado por la dirección (útil si la banda no tiene correo configurado)
membersRouter.post('/:id/reset-link', requirePerm('members.manage'), h(async (req, res) => {
  const target = await one<any>('select role from users where id = $1', [req.params.id]);
  if (!target) throw new HttpError(404, 'Componente no encontrado.');
  if (target.role === 'director' && req.user!.id !== req.params.id) throw new HttpError(403, 'No puedes restablecer la cuenta de dirección.');
  const token = randomToken();
  await q(`insert into password_resets(token_hash, user_id, expires_at, created_by) values ($1,$2, now() + interval '24 hours', $3)`, [sha256(token), req.params.id, req.user!.id]);
  await audit(req.user!.id, 'reset_link', 'user', req.params.id);
  res.json({ link: `${config.publicUrl}/restablecer/${token}`, expires: '24 horas' });
}));

// Invitaciones genéricas
membersRouter.get('/invitations/list', requirePerm('members.manage'), h(async (_req, res) => {
  res.json(await q(`select i.code, i.email, i.role, i.created_at, i.expires_at, i.used_at, u.name as used_by_name from invitations i left join users u on u.id = i.used_by order by i.created_at desc limit 100`));
}));
membersRouter.delete('/invitations/:code', requirePerm('members.manage'), h(async (req, res) => {
  await q('delete from invitations where code = $1 and used_at is null', [req.params.code]);
  res.json({ ok: true });
}));

// ===== Exportación e importación autorizadas =====
membersRouter.get('/export/csv', requirePerm('members.manage'), h(async (req, res) => {
  const rows = await q<any>(`select u.name, u.email, u.role, u.status, u.joined_at, s.name as section, i.name as instrument, v.name as voice, a.is_default
    from users u left join user_assignments a on a.user_id = u.id left join instruments i on i.id = a.instrument_id left join sections s on s.id = i.section_id
    left join voices v on v.id = a.voice_id order by u.name, a.is_default desc`);
  await audit(req.user!.id, 'export', 'members', null, { rows: rows.length });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="componentes.csv"');
  res.send(toCsv([['nombre', 'correo', 'rol', 'estado', 'incorporacion', 'seccion', 'instrumento', 'voz', 'principal'],
    ...rows.map((r) => [r.name, r.email, r.role, r.status, r.joined_at, r.section, r.instrument, r.voice, r.is_default ? 'sí' : ''])]));
}));

const HEADER_ALIASES: Record<string, string[]> = {
  nombre: ['nombre', 'nombre y apellidos', 'nombre completo', 'componente'],
  apellidos: ['apellidos', 'apellido'],
  email: ['correo', 'correo electronico', 'email', 'e-mail', 'mail'],
  instrumento: ['instrumento'],
  voz: ['voz', 'posicion', 'posicion musical', 'voz o posicion'],
  seccion: ['seccion', 'cuerda', 'familia'],
  rol: ['rol', 'rol en la app', 'rol en la aplicacion', 'funcion'],
  permisos: ['permisos', 'permisos especiales'],
  estado: ['estado', 'estado de la cuenta'],
  telefono: ['telefono', 'movil'],
  incorporacion: ['incorporacion', 'fecha de incorporacion', 'alta'],
};

async function readSheet(buf: Buffer, name: string): Promise<string[][]> {
  if (/\.xlsx$/i.test(name) || buf.subarray(0, 2).toString('latin1') === 'PK') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new HttpError(400, 'El Excel no contiene hojas.');
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as any[]).slice(1).map((v) => {
        if (v == null) return '';
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === 'object') return String(v.text ?? v.result ?? (v.richText ? v.richText.map((t: any) => t.text).join('') : ''));
        return String(v);
      });
      rows.push(vals);
    });
    return rows;
  }
  return parseCsv(buf.toString('utf8'));
}

const ROLE_MAP: Record<string, 'member' | 'leader'> = { componente: 'member', musico: 'member', miembro: 'member', member: 'member', responsable: 'leader', 'responsable de seccion': 'leader', leader: 'leader', jefe: 'leader', 'jefe de cuerda': 'leader' };
const STATUS_MAP: Record<string, 'active' | 'inactive' | 'baja'> = { activo: 'active', activa: 'active', active: 'active', pendiente: 'inactive', inactivo: 'inactive', inactiva: 'inactive', inactive: 'inactive', baja: 'baja' };

/**
 * Importación de componentes desde CSV o Excel.
 * modo=previsualizar: valida y devuelve qué se haría. modo=importar: aplica.
 * Nunca concede el rol de dirección por importación.
 */
membersRouter.post('/import', requirePerm('members.manage'), upload.single('file'), h(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Falta el archivo CSV o Excel.');
  const mode = req.body.modo === 'importar' ? 'importar' : 'previsualizar';
  const createMissing = req.body.crear_estructura === '1';
  const rows = await readSheet(req.file.buffer, req.file.originalname);
  if (rows.length < 2) throw new HttpError(400, 'El archivo no contiene filas de datos.');
  const header = rows[0].map(norm);
  const col: Record<string, number> = {};
  for (const [k, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = header.findIndex((hd) => aliases.includes(hd));
    if (idx >= 0) col[k] = idx;
  }
  if (col.nombre == null || col.email == null) throw new HttpError(400, 'El archivo debe tener al menos las columnas «nombre» y «correo».');

  const sections = await q<any>('select * from sections');
  const instruments = await q<any>('select * from instruments');
  const voices = await q<any>('select * from voices');
  const existing = new Map((await q<any>('select id, lower(email) as email, role from users')).map((u) => [u.email, u]));
  const seen = new Set<string>();

  type Row = { line: number; name: string; email: string; role: 'member' | 'leader'; status: 'active' | 'inactive' | 'baja'; permissions: string[];
    section?: string; instrument?: string; voice?: string; phone?: string; joined?: string; action: 'crear' | 'actualizar' | 'error'; errors: string[]; warnings: string[];
    instrument_id?: number; voice_id?: number | null; create?: { section?: string; instrument?: string; voice?: string } };
  const out: Row[] = [];
  const cell = (r: string[], k: string) => (col[k] != null ? (r[col[k]] ?? '').trim() : '');

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = [cell(r, 'nombre'), cell(r, 'apellidos')].filter(Boolean).join(' ');
    const email = cell(r, 'email').toLowerCase();
    const row: Row = { line: i + 1, name, email, role: 'member', status: 'inactive', permissions: [], action: 'crear', errors: [], warnings: [] };
    if (name.length < 2) row.errors.push('Falta el nombre');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) row.errors.push('Correo no válido');
    if (seen.has(email)) row.errors.push('Correo repetido en el archivo');
    seen.add(email);
    const rol = norm(cell(r, 'rol'));
    if (rol) {
      if (/direct/.test(rol)) row.errors.push('El rol de dirección no se puede conceder por importación; asígnalo manualmente');
      else if (ROLE_MAP[rol]) row.role = ROLE_MAP[rol];
      else row.warnings.push(`Rol «${cell(r, 'rol')}» no reconocido: se usará «componente»`);
    }
    const est = norm(cell(r, 'estado'));
    if (est) { if (STATUS_MAP[est]) row.status = STATUS_MAP[est]; else row.warnings.push(`Estado «${cell(r, 'estado')}» no reconocido: pendiente de activar`); }
    const perms = cell(r, 'permisos').split(/[,|]/).map((p) => p.trim()).filter(Boolean);
    for (const p of perms) { if (p in GLOBAL_PERMISSIONS) row.permissions.push(p); else row.warnings.push(`Permiso desconocido «${p}» ignorado`); }
    row.phone = cell(r, 'telefono') || undefined;
    const joined = cell(r, 'incorporacion');
    if (joined) { if (/^\d{4}-\d{2}-\d{2}$/.test(joined)) row.joined = joined; else { const m = joined.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); if (m) row.joined = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; } }

    const instName = cell(r, 'instrumento');
    const voiceName = cell(r, 'voz');
    const secName = cell(r, 'seccion');
    row.instrument = instName; row.voice = voiceName; row.section = secName;
    if (instName) {
      const cands = instruments.filter((x) => norm(x.name) === norm(instName) && (!secName || norm(sections.find((s) => s.id === x.section_id)?.name ?? '') === norm(secName)));
      if (cands.length === 1) {
        row.instrument_id = cands[0].id;
        if (voiceName) {
          const v = voices.find((x) => x.instrument_id === cands[0].id && norm(x.name) === norm(voiceName));
          if (v) row.voice_id = v.id;
          else if (createMissing) row.create = { voice: voiceName };
          else row.errors.push(`La voz «${voiceName}» no existe para ${cands[0].name}`);
        } else row.voice_id = null;
      } else if (cands.length > 1) row.errors.push(`Instrumento «${instName}» ambiguo: indica la sección`);
      else if (createMissing) {
        if (!secName) row.errors.push(`El instrumento «${instName}» no existe; indica su sección para crearlo`);
        else row.create = { section: secName, instrument: instName, voice: voiceName || undefined };
      } else row.errors.push(`El instrumento «${instName}» no existe en la estructura de la banda`);
    } else row.warnings.push('Sin instrumento asignado');

    const ex = existing.get(email);
    if (ex) {
      row.action = 'actualizar';
      if (ex.role === 'director') row.errors.push('No se puede modificar la cuenta de dirección por importación');
    }
    if (row.errors.length) row.action = 'error';
    out.push(row);
  }

  const summary = { total: out.length, crear: out.filter((r) => r.action === 'crear').length, actualizar: out.filter((r) => r.action === 'actualizar').length, errores: out.filter((r) => r.action === 'error').length };
  if (mode === 'previsualizar') return res.json({ mode, summary, rows: out });
  if (summary.errores > 0) throw new HttpError(400, `Corrige las ${summary.errores} filas con errores antes de importar.`);

  const invitations: { name: string; email: string; link: string }[] = [];
  await tx(async (c) => {
    for (const row of out) {
      // crea la estructura que falte (solo si se pidió explícitamente)
      if (row.create) {
        let instId = row.instrument_id;
        if (row.create.instrument) {
          let sec = await one<any>('select id from sections where lower(name) = lower($1)', [row.create.section], c);
          sec ??= await one<any>('insert into sections(name, family) values ($1, $2) returning id', [row.create.section, /percus|tambor|bombo|caja|plato/i.test(row.create.section!) ? 'percusion' : 'viento'], c);
          let inst = await one<any>('select id from instruments where section_id = $1 and lower(name) = lower($2)', [sec.id, row.create.instrument], c);
          inst ??= await one<any>(`insert into instruments(section_id, name, clef, transposition) values ($1,$2,$3,$4) returning id`,
            [sec.id, row.create.instrument, /percus|tambor|bombo|caja|plato/i.test(row.create.instrument!) ? 'percussion' : /trombon|bombard|tuba/i.test(row.create.instrument!) ? 'bass' : 'treble', /corneta|trompeta|fliscorno/i.test(row.create.instrument!) ? -2 : 0], c);
          instId = inst.id;
        }
        row.instrument_id = instId;
        if (row.create.voice) {
          let v = await one<any>('select id from voices where instrument_id = $1 and lower(name) = lower($2)', [instId, row.create.voice], c);
          v ??= await one<any>('insert into voices(instrument_id, name) values ($1,$2) returning id', [instId, row.create.voice], c);
          row.voice_id = v.id;
        } else row.voice_id ??= null;
      }
      const after = row.instrument_id ? [{ instrument_id: row.instrument_id, voice_id: row.voice_id ?? null, is_default: true }] : [];
      if (row.action === 'crear') {
        const u = await one<any>(`insert into users(email, password_hash, name, role, status, permissions, phone, joined_at) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
          [row.email, hashPassword(randomToken()), row.name, row.role, row.status, row.permissions, row.phone ?? null, row.joined ?? null], c);
        for (const a of after) await q('insert into user_assignments(user_id, instrument_id, voice_id, is_default) values ($1,$2,$3,true)', [u.id, a.instrument_id, a.voice_id], c);
        await q(`insert into assignment_changes(user_id, before, after, status, reason, requested_by, applied_by, applied_at) values ($1,'[]',$2,'aplicado','Importación',$3,$3,now())`, [u.id, JSON.stringify(after), req.user!.id], c);
        if (row.status !== 'baja') invitations.push({ name: row.name, email: row.email, link: (await inviteFor(u.id, row.email, req.user!.id, c)).link });
      } else {
        const u = existing.get(row.email)!;
        await q(`update users set name = $2, role = $3, status = $4, permissions = $5, phone = coalesce($6, phone), joined_at = coalesce($7, joined_at) where id = $1`,
          [u.id, row.name, row.role, row.status, row.permissions, row.phone ?? null, row.joined ?? null], c);
        if (after.length) {
          const before = (await userAssignments(u.id, c)).map((a) => ({ instrument_id: a.instrument_id, voice_id: a.voice_id, is_default: a.is_default }));
          if (JSON.stringify(before) !== JSON.stringify(after)) {
            // los cambios de asignación de una importación quedan pendientes de confirmar por la dirección
            await q(`update assignment_changes set status='cancelado' where user_id=$1 and status='pendiente'`, [u.id], c);
            await q(`insert into assignment_changes(user_id, before, after, reason, requested_by) values ($1,$2,$3,'Importación',$4)`, [u.id, JSON.stringify(before), JSON.stringify(after), req.user!.id], c);
          }
        }
      }
    }
    await audit(req.user!.id, 'import', 'members', null, summary, c);
  });
  res.json({ mode, summary, invitations });
}));

membersRouter.get('/import/template', requirePerm('members.manage'), h(async (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla-componentes.csv"');
  res.send(toCsv([
    ['nombre', 'apellidos', 'correo', 'seccion', 'instrumento', 'voz', 'rol', 'permisos', 'estado'],
    ['Componente', 'A (ejemplo)', 'componente.a@example.com', 'Cornetas', 'Corneta', '3ª voz', 'componente', '', 'pendiente'],
  ]));
}));
