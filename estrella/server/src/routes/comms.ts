import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.ts';
import { h, parse, HttpError } from '../lib/http.ts';
import { requireAuth, can, sectionsWith, isStaff, type AuthUser } from '../lib/auth.ts';
import { upload, storeFile } from '../lib/files.ts';
import { hub } from '../realtime.ts';

export const commsRouter = Router();
commsRouter.use(requireAuth);

const targets = (u: AuthUser, sections: number[]) => sections.length === 0 || sections.some((s) => u.sectionIds.includes(s)) || u.role === 'director';

commsRouter.get('/announcements', h(async (req, res) => {
  const rows = await q<any>(`select a.*, u.name as author_name, (r.read_at is not null) as read,
      (select count(*) from announcement_reads x where x.announcement_id = a.id)::int as read_count
    from announcements a left join users u on u.id = a.author_id left join announcement_reads r on r.announcement_id = a.id and r.user_id = $1
    where (a.expires_at is null or a.expires_at > now()) order by a.urgent desc, a.created_at desc limit 200`, [req.user!.id]);
  res.json(rows.filter((a) => targets(req.user!, a.section_ids) || a.author_id === req.user!.id));
}));

commsRouter.post('/announcements', h(async (req, res) => {
  const b = parse(z.object({ title: z.string().min(2).max(160), body: z.string().min(1).max(5000), urgent: z.boolean().default(false),
    category: z.enum(['aviso', 'direccion', 'seccion', 'cambio']).default('aviso'), section_ids: z.array(z.number().int()).default([]),
    expires_at: z.string().datetime({ offset: true }).nullable().optional() }), req.body);
  const user = req.user!;
  // a toda la banda: dirección o permiso explícito; a secciones: responsables con permiso «announce» en ellas
  if (b.section_ids.length === 0 ? !can(user, 'announce.all') : (() => { const s = sectionsWith(user, 'announce', 'announce.all'); return s !== 'all' && !b.section_ids.every((x) => s.includes(x)); })()) {
    throw new HttpError(403, 'No puedes publicar avisos para ese público.');
  }
  if (b.urgent && user.role !== 'director' && !user.permissions.includes('announce.all')) throw new HttpError(403, 'Solo la dirección publica avisos urgentes.');
  const a = await one<any>(`insert into announcements(title, body, urgent, category, section_ids, author_id, expires_at) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [b.title, b.body, b.urgent, b.urgent && b.category === 'aviso' ? 'direccion' : b.category, b.section_ids, user.id, b.expires_at ?? null]);
  hub.toAll({ t: 'announcement', announcement: { ...a, author_name: user.name } }, (c) => targets(c.user, a.section_ids) || c.user.id === user.id);
  res.json(a);
}));

commsRouter.post('/announcements/:id/read', h(async (req, res) => {
  await q('insert into announcement_reads(announcement_id, user_id) values ($1,$2) on conflict do nothing', [req.params.id, req.user!.id]);
  res.json({ ok: true });
}));

commsRouter.get('/announcements/:id/reads', h(async (req, res) => {
  const a = await one<any>('select author_id, section_ids from announcements where id = $1', [req.params.id]);
  if (!a) throw new HttpError(404, 'Aviso no encontrado.');
  if (a.author_id !== req.user!.id && !isStaff(req.user)) throw new HttpError(403, 'Sin permiso.');
  const people = await q<any>(`select u.id, u.name, r.read_at from users u
    left join announcement_reads r on r.user_id = u.id and r.announcement_id = $1
    where u.status = 'active' and (cardinality($2::int[]) = 0 or exists (select 1 from user_assignments ua join instruments i on i.id = ua.instrument_id where ua.user_id = u.id and i.section_id = any($2)))
    order by r.read_at nulls first, u.name`, [req.params.id, a.section_ids]);
  res.json(people);
}));

commsRouter.delete('/announcements/:id', h(async (req, res) => {
  const a = await one<any>('select author_id from announcements where id = $1', [req.params.id]);
  if (!a) throw new HttpError(404, 'Aviso no encontrado.');
  if (a.author_id !== req.user!.id && req.user!.role !== 'director') throw new HttpError(403, 'Sin permiso.');
  await q('delete from announcements where id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ===== Documentos internos =====
commsRouter.get('/documents', h(async (req, res) => {
  const rows = await q<any>(`select d.*, f.mime, f.original_name, f.size, u.name as author_name from documents d join files f on f.id = d.file_id left join users u on u.id = d.created_by order by d.category, d.title`);
  res.json(rows.filter((d) => isStaff(req.user) || (!d.restricted && targets(req.user!, d.section_ids))));
}));
commsRouter.post('/documents', upload.single('file'), h(async (req, res) => {
  if (!can(req.user, 'announce.all') && !can(req.user, 'library.manage')) throw new HttpError(403, 'Sin permiso.');
  if (!req.file) throw new HttpError(400, 'Falta el archivo.');
  const b = parse(z.object({ title: z.string().min(1).max(160), category: z.string().max(60).default('general'), restricted: z.enum(['0', '1']).default('0'),
    section_ids: z.string().default('') }), req.body);
  const d = await tx(async (c) => {
    const f = await storeFile(req.file!.buffer, req.file!.originalname, req.user!.id, ['pdf', 'image', 'audio', 'document'], c);
    return one('insert into documents(title, category, file_id, section_ids, restricted, created_by) values ($1,$2,$3,$4,$5,$6) returning *',
      [b.title, b.category, f.id, b.section_ids.split(',').filter(Boolean).map(Number), b.restricted === '1', req.user!.id], c);
  });
  res.json(d);
}));
commsRouter.delete('/documents/:id', h(async (req, res) => {
  if (!can(req.user, 'announce.all') && !can(req.user, 'library.manage')) throw new HttpError(403, 'Sin permiso.');
  await q('delete from documents where id = $1', [req.params.id]);
  res.json({ ok: true });
}));
