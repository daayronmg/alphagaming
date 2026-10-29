import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.ts';
import { h, parse, HttpError } from '../lib/http.ts';
import { requireAuth, can, type AuthUser } from '../lib/auth.ts';
import { hub, type Client } from '../realtime.ts';

export const annotationsRouter = Router();
annotationsRouter.use(requireAuth);

type Audience = { scope: 'all' } | { scope: 'sections'; sections: number[] };

/** ¿Puede este usuario ver una anotación oficial con este público? */
export function audienceMatch(user: AuthUser, audience: Audience): boolean {
  if (audience.scope === 'all') return true;
  if (user.role === 'director' || user.permissions.includes('annotate.official')) return true;
  return audience.sections.some((s) => user.sectionIds.includes(s) || user.leaderOf.some((l) => l.section_id === s));
}

/** ¿Puede escribir en la capa oficial para ese público? Los responsables solo para sus secciones. */
function canWriteOfficial(user: AuthUser, audience: Audience): boolean {
  if (can(user, 'annotate.official')) return true;
  const mine = user.leaderOf.filter((l) => l.permissions.includes('annotate')).map((l) => l.section_id);
  return audience.scope === 'sections' && audience.sections.length > 0 && audience.sections.every((s) => mine.includes(s));
}

const audienceSchema = z.union([
  z.object({ scope: z.literal('all') }),
  z.object({ scope: z.literal('sections'), sections: z.array(z.number().int()).min(1).max(30) }),
]);
const point = z.tuple([z.number().min(-0.1).max(1.1), z.number().min(-0.1).max(1.1)]);
const dataSchema = z.object({
  points: z.array(point).max(4000).optional(),     // trazos (pen, highlighter, line, arrow)
  x: z.number().optional(), y: z.number().optional(), w: z.number().optional(), h: z.number().optional(), // rect/circle/text
  text: z.string().max(1000).optional(),
  symbol: z.string().max(40).optional(),
  width: z.number().min(0.5).max(40).optional(),
  fontSize: z.number().min(6).max(80).optional(),
  noteId: z.string().max(64).optional(),
}).strict();

const createSchema = z.object({
  id: z.string().uuid(),
  marcha_id: z.string().uuid(),
  part_id: z.string().uuid().nullable().optional(),
  score_id: z.string().uuid().nullable().optional(),
  page: z.number().int().min(1).nullable().optional(),
  layer: z.enum(['official', 'personal']),
  audience: audienceSchema.default({ scope: 'all' }),
  kind: z.enum(['pen', 'highlighter', 'text', 'rect', 'circle', 'arrow', 'symbol', 'line', 'measure']),
  data: dataSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6,8}$/).default('#e11d48'),
  measure: z.number().int().min(1).max(2000).nullable().optional(),
  event_id: z.string().uuid().nullable().optional(),
});

const SELECT = `select a.*, u.name as owner_name from annotations a join users u on u.id = a.owner_id`;

function visibleTo(user: AuthUser, a: any): boolean {
  if (a.layer === 'personal') return a.owner_id === user.id;
  return audienceMatch(user, a.audience);
}

function broadcast(a: any, action: 'upsert' | 'delete') {
  const msg = { t: 'annotation', action, annotation: a };
  if (a.layer === 'personal') {
    hub.toUser(a.owner_id, msg); // resto de dispositivos del mismo músico
    return;
  }
  hub.publish(`marcha:${a.marcha_id}`, msg, (c: Client) => visibleTo(c.user, a) || (action === 'delete'));
}

/**
 * Anotaciones visibles para una marcha (y opcionalmente una parte).
 * Con ?since=ISO devuelve solo cambios (incluidas eliminaciones) para recuperar tras una desconexión.
 */
annotationsRouter.get('/', h(async (req, res) => {
  const marcha = String(req.query.marcha || '');
  if (!/^[0-9a-f-]{36}$/.test(marcha)) throw new HttpError(400, 'Falta la marcha.');
  const part = req.query.part ? String(req.query.part) : null;
  const score = req.query.score ? String(req.query.score) : null;
  const since = req.query.since ? new Date(String(req.query.since)) : null;
  const rows = await q<any>(`${SELECT} where a.marcha_id = $1
      and (a.part_id is null and a.score_id is null or a.part_id = $2 or a.score_id = $3)
      and (a.layer = 'official' or a.owner_id = $4)
      and ($5::timestamptz is null and not a.deleted or a.updated_at > $5)
    order by a.created_at`, [marcha, part, score, req.user!.id, since]);
  res.json({ serverTime: new Date().toISOString(), annotations: rows.filter((a) => visibleTo(req.user!, a) || (since && a.deleted)) });
}));

annotationsRouter.post('/', h(async (req, res) => {
  const b = parse(createSchema, req.body);
  if (b.layer === 'official' && !canWriteOfficial(req.user!, b.audience)) {
    throw new HttpError(403, 'No tienes permiso para escribir en la capa oficial.');
  }
  if (!b.part_id && !b.score_id && b.measure == null) throw new HttpError(400, 'Una anotación debe estar en una página o vinculada a un compás.');
  if (b.part_id && b.page == null) throw new HttpError(400, 'Falta la página.');
  const existing = await one<any>('select owner_id, version from annotations where id = $1', [b.id]);
  if (existing) {
    // reintento idempotente (p. ej. cola sin conexión): si ya existe del mismo autor, se devuelve
    if (existing.owner_id !== req.user!.id) throw new HttpError(409, 'Identificador en uso.');
    return res.json(await one(`${SELECT} where a.id = $1`, [b.id]));
  }
  const a = await tx(async (c) => {
    await q(`insert into annotations(id, marcha_id, part_id, score_id, page, layer, owner_id, audience, kind, data, color, measure, event_id, updated_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$7)`,
      [b.id, b.marcha_id, b.part_id ?? null, b.score_id ?? null, b.page ?? null, b.layer, req.user!.id, JSON.stringify(b.layer === 'personal' ? { scope: 'all' } : b.audience),
        b.kind, JSON.stringify(b.data), b.color, b.measure ?? null, b.event_id ?? null], c);
    const a = await one<any>(`${SELECT} where a.id = $1`, [b.id], c);
    await q('insert into annotation_history(annotation_id, user_id, action, version, snapshot) values ($1,$2,$3,$4,$5)', [b.id, req.user!.id, 'crear', 1, JSON.stringify(a)], c);
    return a;
  });
  broadcast(a, 'upsert');
  res.json(a);
}));

async function loadForWrite(id: string, user: AuthUser) {
  const a = await one<any>(`${SELECT} where a.id = $1`, [id]);
  if (!a || a.deleted) throw new HttpError(404, 'Anotación no encontrada.');
  if (a.layer === 'personal' && a.owner_id !== user.id) throw new HttpError(404, 'Anotación no encontrada.');
  if (a.layer === 'official' && !canWriteOfficial(user, a.audience)) throw new HttpError(403, 'No tienes permiso para modificar anotaciones oficiales.');
  return a;
}

/** Actualización con control optimista de versión: nunca se sobrescribe en silencio un cambio ajeno. */
annotationsRouter.put('/:id', h(async (req, res) => {
  const b = parse(z.object({ version: z.number().int(), data: dataSchema.optional(), color: z.string().regex(/^#[0-9a-fA-F]{6,8}$/).optional(),
    audience: audienceSchema.optional(), measure: z.number().int().min(1).nullable().optional() }), req.body);
  const cur = await loadForWrite(req.params.id, req.user!);
  if (b.audience && cur.layer === 'official' && !canWriteOfficial(req.user!, b.audience)) throw new HttpError(403, 'No puedes dirigir la anotación a ese público.');
  const r = await one<any>(`update annotations set data = coalesce($3, data), color = coalesce($4, color), audience = coalesce($5, audience),
      measure = case when $7 then $6 else measure end, version = version + 1, updated_at = now(), updated_by = $8
    where id = $1 and version = $2 returning id`,
    [req.params.id, b.version, b.data ? JSON.stringify(b.data) : null, b.color ?? null, b.audience ? JSON.stringify(b.audience) : null, b.measure ?? null, 'measure' in b, req.user!.id]);
  if (!r) return res.status(409).json({ error: 'La anotación ha sido modificada por otra persona o en otro dispositivo.', current: cur });
  const a = await one<any>(`${SELECT} where a.id = $1`, [req.params.id]);
  await q('insert into annotation_history(annotation_id, user_id, action, version, snapshot) values ($1,$2,$3,$4,$5)', [a.id, req.user!.id, 'modificar', a.version, JSON.stringify(a)]);
  broadcast(a, 'upsert');
  res.json(a);
}));

annotationsRouter.delete('/:id', h(async (req, res) => {
  const cur = await loadForWrite(req.params.id, req.user!);
  const version = req.query.version ? Number(req.query.version) : cur.version;
  const r = await one<any>(`update annotations set deleted = true, version = version + 1, updated_at = now(), updated_by = $3 where id = $1 and version = $2 returning *`, [req.params.id, version, req.user!.id]);
  if (!r) return res.status(409).json({ error: 'La anotación cambió antes de borrarla. Revisa la versión actual.', current: cur });
  await q('insert into annotation_history(annotation_id, user_id, action, version, snapshot) values ($1,$2,$3,$4,null)', [r.id, req.user!.id, 'borrar', r.version]);
  broadcast({ ...r, owner_name: cur.owner_name }, 'delete');
  res.json({ ok: true });
}));

/** Restaurar una anotación borrada (deshacer un borrado). */
annotationsRouter.post('/:id/restore', h(async (req, res) => {
  const a = await one<any>('select * from annotations where id = $1', [req.params.id]);
  if (!a || !a.deleted) throw new HttpError(404, 'No hay nada que restaurar.');
  if (a.layer === 'personal' ? a.owner_id !== req.user!.id : !canWriteOfficial(req.user!, a.audience)) throw new HttpError(403, 'Sin permiso.');
  await q('update annotations set deleted = false, version = version + 1, updated_at = now(), updated_by = $2 where id = $1', [a.id, req.user!.id]);
  const full = await one<any>(`${SELECT} where a.id = $1`, [a.id]);
  await q('insert into annotation_history(annotation_id, user_id, action, version, snapshot) values ($1,$2,$3,$4,$5)', [a.id, req.user!.id, 'restaurar', full.version, JSON.stringify(full)]);
  broadcast(full, 'upsert');
  res.json(full);
}));

annotationsRouter.get('/:id/history', h(async (req, res) => {
  const a = await one<any>('select * from annotations where id = $1', [req.params.id]);
  if (!a || !visibleTo(req.user!, a)) throw new HttpError(404, 'Anotación no encontrada.');
  res.json(await q(`select h.action, h.version, h.at, u.name from annotation_history h left join users u on u.id = h.user_id where h.annotation_id = $1 order by h.at`, [a.id]));
}));
