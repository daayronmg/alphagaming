import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import crypto from 'node:crypto';
import { q, one, tx } from '../db.ts';
import { h, parse, HttpError } from '../lib/http.ts';
import { requireAuth, sectionsWith, type AuthUser } from '../lib/auth.ts';
import { storeFile } from '../lib/files.ts';
import { config } from '../config.ts';
import { hub } from '../realtime.ts';
import { userAssignments } from './members.ts';
import { audienceMatch } from './annotations.ts';

export const doubtsRouter = Router();
doubtsRouter.use(requireAuth);

const multi = multer({ storage: multer.memoryStorage(), limits: { fileSize: Math.min(config.maxUploadMb, 15) * 1024 * 1024, files: 3 } })
  .fields([{ name: 'crop', maxCount: 1 }, { name: 'audio', maxCount: 1 }, { name: 'attachment', maxCount: 1 }]);

const rectSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) });

const SELECT = `select d.*, u.name as author_name, m.title as marcha_title, p.label as part_label, p.instrument_id, i.name as instrument, v.name as voice,
   i.section_id, (select count(*) from doubt_replies r where r.doubt_id = d.id)::int as replies
  from doubts d join users u on u.id = d.author_id join marchas m on m.id = d.marcha_id join parts p on p.id = d.part_id
  left join instruments i on i.id = p.instrument_id left join voices v on v.id = p.voice_id`;

/** Secciones cuyas dudas puede gestionar el usuario ('all' para la dirección). */
function manageable(user: AuthUser) {
  return sectionsWith(user, 'doubts', 'scores.publish');
}
function canManage(user: AuthUser, d: any) {
  const s = manageable(user);
  return s === 'all' || (d.section_id != null && s.includes(d.section_id));
}
function canSee(user: AuthUser, d: any) {
  if (d.author_id === user.id || canManage(user, d)) return true;
  if (d.visibility === 'band') return true;
  if (d.visibility === 'section') return d.section_id != null && user.sectionIds.includes(d.section_id);
  return false;
}

function iou(a: any, b: any) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}

function notifyNew(d: any) {
  hub.toStaff({ t: 'doubt:new', doubt: { id: d.id, marcha_title: d.marcha_title, author_name: d.author_name, instrument: d.instrument, voice: d.voice, text: d.text, section_id: d.section_id, priority: d.priority } });
}

doubtsRouter.post('/', multi, h(async (req, res) => {
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const b = parse(z.object({
    part_id: z.string().uuid(), page: z.number().int().min(1), rect: rectSchema,
    measure: z.number().int().min(1).max(2000).nullable().optional(),
    text: z.string().min(3).max(2000),
    drawing: z.any().optional(),
  }), JSON.parse(req.body.payload || '{}'));
  const part = await one<any>('select marcha_id from parts where id = $1', [b.part_id]);
  if (!part) throw new HttpError(404, 'Partitura no encontrada.');
  const d = await tx(async (c) => {
    const crop = files.crop?.[0] ? await storeFile(files.crop[0].buffer, 'fragmento.png', req.user!.id, ['image'], c) : null;
    const audio = files.audio?.[0] ? await storeFile(files.audio[0].buffer, 'duda.webm', req.user!.id, ['audio'], c) : null;
    const id = crypto.randomUUID();
    await q(`insert into doubts(id, part_id, marcha_id, page, rect, measure, crop_file_id, audio_file_id, text, author_id, annotation_payload)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, b.part_id, part.marcha_id, b.page, JSON.stringify(b.rect), b.measure ?? null, crop?.id ?? null, audio?.id ?? null, b.text, req.user!.id, b.drawing ? JSON.stringify(b.drawing) : null], c);
    return one<any>(`${SELECT} where d.id = $1`, [id], c);
  });
  notifyNew(d);
  res.json(d);
}));

/**
 * Listado:
 *  ?scope=inbox  → bandeja de la dirección/responsables (con filtros y detección de repetidas)
 *  ?scope=mine   → mis dudas
 *  ?marcha=&part= → dudas visibles sobre una partitura (propias + compartidas)
 */
doubtsRouter.get('/', h(async (req, res) => {
  const f = req.query as Record<string, string>;
  const user = req.user!;
  let rows: any[];
  if (f.scope === 'inbox') {
    const secs = manageable(user);
    if (secs !== 'all' && secs.length === 0) throw new HttpError(403, 'No gestionas dudas de ninguna sección.');
    rows = await q<any>(`${SELECT} where ($1::int[] is null or i.section_id = any($1)) order by d.priority desc, d.created_at desc limit 500`, [secs === 'all' ? null : secs]);
    // repetidas: misma parte y página con zonas solapadas, o mismo compás en la misma marcha
    for (const d of rows) {
      d.similar = rows.filter((o) => o.id !== d.id && o.marcha_id === d.marcha_id && (
        (o.part_id === d.part_id && o.page === d.page && iou(o.rect, d.rect) > 0.25) || (d.measure != null && o.measure === d.measure))).map((o) => o.id);
    }
    if (f.status) rows = rows.filter((d) => d.status === f.status);
    if (f.marcha) rows = rows.filter((d) => d.marcha_id === f.marcha);
    if (f.instrument) rows = rows.filter((d) => String(d.instrument_id) === f.instrument);
    if (f.priority === '1') rows = rows.filter((d) => d.priority);
  } else if (f.scope === 'mine') {
    rows = await q<any>(`${SELECT} where d.author_id = $1 order by d.created_at desc`, [user.id]);
  } else {
    if (!f.marcha) throw new HttpError(400, 'Falta la marcha.');
    rows = (await q<any>(`${SELECT} where d.marcha_id = $1 and ($2::uuid is null or d.part_id = $2) order by d.created_at desc`, [f.marcha, f.part || null])).filter((d) => canSee(user, d));
  }
  res.json(rows);
}));

doubtsRouter.get('/counts', h(async (req, res) => {
  const secs = manageable(req.user!);
  if (secs !== 'all' && secs.length === 0) return res.json({ nueva: 0, pendiente: 0 });
  const r = await one<any>(`select count(*) filter (where d.status='nueva')::int as nueva, count(*) filter (where d.status='pendiente')::int as pendiente
    from doubts d join parts p on p.id = d.part_id left join instruments i on i.id = p.instrument_id where ($1::int[] is null or i.section_id = any($1))`, [secs === 'all' ? null : secs]);
  res.json(r);
}));

doubtsRouter.get('/:id', h(async (req, res) => {
  const d = await one<any>(`${SELECT} where d.id = $1`, [req.params.id]);
  if (!d || !canSee(req.user!, d)) throw new HttpError(404, 'Duda no encontrada.');
  const replies = await q(`select r.*, u.name as author_name from doubt_replies r join users u on u.id = r.author_id where r.doubt_id = $1 order by r.created_at`, [d.id]);
  const author = canManage(req.user!, d) ? { assignments: await userAssignments(d.author_id) } : undefined;
  // al abrirla la dirección, pasa de «nueva» a «pendiente»
  if (d.status === 'nueva' && canManage(req.user!, d)) {
    await q(`update doubts set status = 'pendiente', updated_at = now() where id = $1 and status = 'nueva'`, [d.id]);
    d.status = 'pendiente';
  }
  res.json({ ...d, replies_list: replies, author, can_manage: canManage(req.user!, d) });
}));

doubtsRouter.put('/:id', h(async (req, res) => {
  const d = await one<any>(`${SELECT} where d.id = $1`, [req.params.id]);
  if (!d || !canManage(req.user!, d)) throw new HttpError(403, 'Sin permiso para gestionar esta duda.');
  const b = parse(z.object({ status: z.enum(['nueva', 'pendiente', 'respondida']).optional(), priority: z.boolean().optional(), visibility: z.enum(['private', 'section', 'band']).optional() }), req.body);
  await q('update doubts set status = coalesce($2,status), priority = coalesce($3,priority), visibility = coalesce($4,visibility), updated_at = now() where id = $1',
    [d.id, b.status ?? null, b.priority ?? null, b.visibility ?? null]);
  hub.toUser(d.author_id, { t: 'doubt:updated', doubtId: d.id, marchaId: d.marcha_id });
  if (b.visibility && b.visibility !== 'private') hub.publish(`marcha:${d.marcha_id}`, { t: 'doubt:shared', doubtId: d.id, marchaId: d.marcha_id });
  res.json({ ok: true });
}));

doubtsRouter.post('/:id/replies', multi, h(async (req, res) => {
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  const d = await one<any>(`${SELECT} where d.id = $1`, [req.params.id]);
  if (!d || !canSee(req.user!, d)) throw new HttpError(404, 'Duda no encontrada.');
  const manager = canManage(req.user!, d);
  if (!manager && d.author_id !== req.user!.id) throw new HttpError(403, 'Solo quien pregunta y la dirección pueden responder.');
  const b = parse(z.object({ text: z.string().max(3000).optional(), drawing: z.any().optional() }), JSON.parse(req.body.payload || '{}'));
  if (!b.text && !files.audio && !files.attachment && !b.drawing) throw new HttpError(400, 'La respuesta está vacía.');
  const r = await tx(async (c) => {
    const audio = files.audio?.[0] ? await storeFile(files.audio[0].buffer, 'respuesta.webm', req.user!.id, ['audio'], c) : null;
    const att = files.attachment?.[0] ? await storeFile(files.attachment[0].buffer, files.attachment[0].originalname, req.user!.id, ['pdf', 'image', 'audio'], c) : null;
    const r = await one<any>(`insert into doubt_replies(doubt_id, author_id, text, audio_file_id, attachment_file_id, drawing) values ($1,$2,$3,$4,$5,$6) returning *`,
      [d.id, req.user!.id, b.text ?? null, audio?.id ?? null, att?.id ?? null, b.drawing ? JSON.stringify(b.drawing) : null], c);
    if (manager) await q(`update doubts set status = 'respondida', updated_at = now() where id = $1`, [d.id], c);
    else await q(`update doubts set status = 'pendiente', updated_at = now() where id = $1`, [d.id], c);
    return r;
  });
  const payload = { t: 'doubt:reply', doubtId: d.id, marchaId: d.marcha_id, partId: d.part_id, reply: { ...r, author_name: req.user!.name } };
  hub.toUser(d.author_id, payload);
  if (!manager) hub.toStaff(payload);
  else if (d.visibility !== 'private') hub.publish(`marcha:${d.marcha_id}`, payload);
  res.json(r);
}));

/** Convierte una duda (y su respuesta) en anotación oficial permanente sobre el fragmento. */
doubtsRouter.post('/:id/promote', h(async (req, res) => {
  const d = await one<any>(`${SELECT} where d.id = $1`, [req.params.id]);
  if (!d || !canManage(req.user!, d)) throw new HttpError(403, 'Sin permiso.');
  const b = parse(z.object({ text: z.string().min(1).max(1000), scope: z.enum(['part', 'section', 'band']).default('part') }), req.body);
  const id = crypto.randomUUID();
  const audience = b.scope === 'band' || d.section_id == null ? { scope: 'all' } : { scope: 'sections', sections: [d.section_id] };
  // Siempre anclada a la zona exacta de la parte; si se conoce el compás, también se guarda para mostrarla en otras partes
  await q(`insert into annotations(id, marcha_id, part_id, page, layer, owner_id, audience, kind, data, color, measure, doubt_id, updated_by)
    values ($1,$2,$3,$4,'official',$5,$6,'rect',$7,'#2563eb',$8,$9,$5)`,
    [id, d.marcha_id, b.scope === 'band' && d.measure ? null : d.part_id, b.scope === 'band' && d.measure ? null : d.page, req.user!.id, JSON.stringify(audience),
      JSON.stringify({ ...d.rect, text: b.text }), d.measure, d.id]);
  await q(`update doubts set promoted_annotation_id = $2, status = 'respondida', visibility = case when $3 = 'band' then 'band' when $3 = 'section' then 'section' else visibility end, updated_at = now() where id = $1`, [d.id, id, b.scope]);
  const a = await one<any>(`select a.*, u.name as owner_name from annotations a join users u on u.id = a.owner_id where a.id = $1`, [id]);
  hub.publish(`marcha:${d.marcha_id}`, { t: 'annotation', action: 'upsert', annotation: a }, (c) => audienceMatch(c.user, a.audience));
  hub.toUser(d.author_id, { t: 'doubt:updated', doubtId: d.id, marchaId: d.marcha_id });
  res.json(a);
}));
