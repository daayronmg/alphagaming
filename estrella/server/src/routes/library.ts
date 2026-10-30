import { Router } from 'express';
import { z } from 'zod';
import { validateBook } from '../../../shared/book.ts';
import { q, one, tx, audit, type Db } from '../db.ts';
import { h, parse, HttpError } from '../lib/http.ts';
import { requireAuth, requirePerm } from '../lib/auth.ts';
import { upload, storeFile } from '../lib/files.ts';
import { hub } from '../realtime.ts';
import { userAssignments, type Assignment } from './members.ts';

export const libraryRouter = Router();
libraryRouter.use(requireAuth);
const manage = requirePerm('library.manage');

const PART_SELECT = `select p.id, p.marcha_id, p.instrument_id, i.name as instrument, p.voice_id, v.name as voice, p.label, p.arrangement,
  p.file_id, f.kind as file_kind, f.mime, f.original_name, f.size, p.page_count, p.page_from, p.page_to, p.version, p.active, p.replaces_part_id, p.created_at,
  (select count(*) from part_measures pm where pm.part_id = p.id)::int as mapped_measures
  from parts p join files f on f.id = p.file_id left join instruments i on i.id = p.instrument_id left join voices v on v.id = p.voice_id`;

export interface PartResolution {
  assignment: Assignment | null;
  part: any | null;
  score: any | null;
  status: 'ok' | 'falta_parte' | 'sin_asignacion';
  message: string;
  reference: any | null; // partitura general (solo como referencia, nunca como «tu parte»)
  available: { label: string; instrument: string | null; voice: string | null }[];
  assignments: Assignment[];
}

/**
 * Localiza la parte musical de un componente para una marcha.
 * Orden: parte elegida por la dirección para el evento → asignación por defecto → primera asignación.
 * Coincidencia: instrumento + voz exactos; si no existe, parte común del instrumento (sin voz).
 * Si no hay coincidencia, se informa de que falta: nunca se muestra la parte de otra voz como propia.
 */
export async function resolvePart(userId: string, marchaId: string, opts: { eventId?: string | null; assignmentId?: number | null } = {}, db?: Db): Promise<PartResolution> {
  const assignments = await userAssignments(userId, db);
  let a: Assignment | undefined;
  if (opts.assignmentId) a = assignments.find((x) => x.id === opts.assignmentId);
  if (!a && opts.eventId) {
    const o = await one<any>('select assignment_id from event_assignment_overrides where event_id = $1 and user_id = $2', [opts.eventId, userId], db);
    if (o) a = assignments.find((x) => x.id === o.assignment_id);
  }
  a ??= assignments.find((x) => x.is_default) ?? assignments[0];
  const parts = await q<any>(`${PART_SELECT} where p.marcha_id = $1 and p.active order by i.sort, v.sort, p.label`, [marchaId], db);
  const scores = await q<any>(`select s.id, s.label, s.instrument_id, s.voice_id, s.part_id, s.published_version_id, sv.number as version_number, s.needs_review
    from scores s left join score_versions sv on sv.id = s.published_version_id where s.marcha_id = $1`, [marchaId], db);
  const reference = parts.find((p) => p.instrument_id == null) ?? null;
  const available = parts.filter((p) => p.instrument_id != null).map((p) => ({ label: p.label, instrument: p.instrument, voice: p.voice }));
  if (!a) {
    return { assignment: null, part: null, score: null, status: 'sin_asignacion', message: 'No tienes instrumento ni voz asignados. La dirección debe completar tu ficha.', reference, available, assignments };
  }
  const exact = (x: any) => x.instrument_id === a!.instrument_id && (x.voice_id ?? null) === (a!.voice_id ?? null);
  const common = (x: any) => x.instrument_id === a!.instrument_id && x.voice_id == null;
  const part = parts.find(exact) ?? parts.find(common) ?? null;
  const score = scores.filter((s) => s.published_version_id).find(exact) ?? scores.filter((s) => s.published_version_id).find(common) ?? null;
  const who = `${a.instrument}${a.voice ? ` · ${a.voice}` : ''}`;
  if (!part && !score) {
    return { assignment: a, part: null, score: null, status: 'falta_parte', message: `Esta marcha todavía no tiene partitura para ${who}.`, reference, available, assignments };
  }
  return { assignment: a, part, score, status: 'ok', message: `Tu parte: ${who}`, reference, available, assignments };
}

// ===== Búsqueda y fichas =====
libraryRouter.get('/marchas', h(async (req, res) => {
  const f = req.query as Record<string, string>;
  const params: unknown[] = [req.user!.id];
  const where: string[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll('$?', `$${params.length}`)); };
  if (f.q) add(`(unaccent_lower(m.title) like '%' || unaccent_lower($?) || '%' or unaccent_lower(coalesce(m.composer,'')) like '%' || unaccent_lower($?) || '%')`, f.q);
  if (f.composer) add(`unaccent_lower(coalesce(m.composer,'')) like '%' || unaccent_lower($?) || '%'`, f.composer);
  if (f.difficulty) add('m.difficulty = $?', Number(f.difficulty));
  if (f.instrument) add('exists (select 1 from parts p where p.marcha_id = m.id and p.active and p.instrument_id = $?)', Number(f.instrument));
  if (f.event) add('exists (select 1 from event_repertoire er where er.marcha_id = m.id and er.event_id = $?)', f.event);
  if (f.tag) add('exists (select 1 from marcha_tags mt where mt.marcha_id = m.id and mt.tag_id = $?)', Number(f.tag));
  if (f.folder) add('m.folder_id = $?', Number(f.folder));
  if (f.fav === '1') where.push('fav.user_id is not null');
  if (f.type) add('m.march_type = $?', f.type);
  const rows = await q(`select m.id, m.title, m.composer, m.year, m.duration_sec, m.march_type, m.difficulty, m.measures, m.folder_id, m.is_demo, m.updated_at, m.last_reviewed_at,
      (fav.user_id is not null) as favorite,
      (select count(*) from parts p where p.marcha_id = m.id and p.active)::int as parts,
      (select count(*) from recordings r where r.marcha_id = m.id)::int as recordings,
      (select count(*) from scores s where s.marcha_id = m.id and s.published_version_id is not null)::int as scores,
      coalesce((select json_agg(t.name order by t.name) from marcha_tags mt join tags t on t.id = mt.tag_id where mt.marcha_id = m.id), '[]') as tags
    from marchas m left join favorites fav on fav.marcha_id = m.id and fav.user_id = $1
    ${where.length ? 'where ' + where.join(' and ') : ''} order by m.title`, params);
  res.json(rows);
}));

libraryRouter.get('/meta', h(async (_req, res) => {
  res.json({
    folders: await q('select * from folders order by name'),
    tags: await q('select * from tags order by name'),
    types: (await q<any>(`select distinct march_type from marchas where march_type is not null order by 1`)).map((r) => r.march_type),
  });
}));

libraryRouter.get('/marchas/:id', h(async (req, res) => {
  const m = await one<any>(`select m.*, (select true from favorites f where f.marcha_id = m.id and f.user_id = $2) as favorite from marchas m where m.id = $1`, [req.params.id, req.user!.id]);
  if (!m) throw new HttpError(404, 'Marcha no encontrada.');
  const [tags, parts, oldParts, recordings, scores, changes, history] = await Promise.all([
    q('select t.* from marcha_tags mt join tags t on t.id = mt.tag_id where mt.marcha_id = $1 order by t.name', [m.id]),
    q(`${PART_SELECT} where p.marcha_id = $1 and p.active order by p.instrument_id nulls first, i.sort, v.sort`, [m.id]),
    q(`${PART_SELECT} where p.marcha_id = $1 and not p.active order by p.created_at desc`, [m.id]),
    q(`select r.*, f.mime, f.original_name, i.name as instrument, v.name as voice from recordings r join files f on f.id = r.file_id
       left join instruments i on i.id = r.instrument_id left join voices v on v.id = r.voice_id where r.marcha_id = $1 order by r.created_at`, [m.id]),
    q(`select s.id, s.label, s.instrument_id, s.voice_id, s.part_id, s.source, s.needs_review, s.published_version_id, sv.number as version_number, sv.created_at as published_at,
       i.name as instrument, v.name as voice, (s.draft is not null) as has_draft
       from scores s left join score_versions sv on sv.id = s.published_version_id left join instruments i on i.id = s.instrument_id left join voices v on v.id = s.voice_id
       where s.marcha_id = $1 order by i.sort, v.sort`, [m.id]),
    q(`select c.*, u.name as user_name from marcha_changes c left join users u on u.id = c.user_id where c.marcha_id = $1 order by c.at desc limit 50`, [m.id]),
    q(`select e.id, e.title, e.type, e.starts_at,
         coalesce((select json_agg(json_build_object('from', pw.measure_from, 'to', pw.measure_to, 'note', pw.note)) from passage_work pw where pw.event_id = e.id and pw.marcha_id = $1), '[]') as passages
       from events e where exists (select 1 from event_repertoire er where er.event_id = e.id and er.marcha_id = $1)
          or exists (select 1 from passage_work pw where pw.event_id = e.id and pw.marcha_id = $1)
       order by e.starts_at desc limit 30`, [m.id]),
  ]);
  const mine = await resolvePart(req.user!.id, m.id);
  q(`insert into material_usage(user_id, kind, ref_id) values ($1,'marcha',$2)`, [req.user!.id, m.id]).catch(() => {});
  res.json({ ...m, favorite: !!m.favorite, tags, parts, old_parts: oldParts, recordings, scores, changes, history, mine });
}));

const marchaBody = z.object({
  title: z.string().min(1).max(200),
  composer: z.string().max(200).nullable().optional(),
  year: z.number().int().min(1500).max(2100).nullable().optional(),
  duration_sec: z.number().int().min(0).max(7200).nullable().optional(),
  march_type: z.string().max(80).nullable().optional(),
  instrumentation: z.string().max(300).nullable().optional(),
  measures: z.number().int().min(0).max(2000).nullable().optional(),
  director_notes: z.string().max(5000).nullable().optional(),
  difficulty: z.number().int().min(1).max(5).nullable().optional(),
  folder_id: z.number().int().nullable().optional(),
  last_reviewed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});
const FIELDS = ['title', 'composer', 'year', 'duration_sec', 'march_type', 'instrumentation', 'measures', 'director_notes', 'difficulty', 'folder_id', 'last_reviewed_at'] as const;

async function setTags(marchaId: string, tags: string[], db: Db) {
  await q('delete from marcha_tags where marcha_id = $1', [marchaId], db);
  for (const t of tags) {
    const tag = await one<any>('insert into tags(name) values ($1) on conflict (name) do update set name = excluded.name returning id', [t.trim()], db);
    await q('insert into marcha_tags values ($1,$2) on conflict do nothing', [marchaId, tag.id], db);
  }
}

libraryRouter.post('/marchas', manage, h(async (req, res) => {
  const b = parse(marchaBody, req.body);
  const m = await tx(async (c) => {
    const m = await one<any>(`insert into marchas(${FIELDS.join(',')}, created_by) values (${FIELDS.map((_, i) => `$${i + 1}`).join(',')}, $${FIELDS.length + 1}) returning *`,
      [...FIELDS.map((f) => (b as any)[f] ?? null), req.user!.id], c);
    if (b.tags) await setTags(m.id, b.tags, c);
    await q('insert into marcha_changes(marcha_id, user_id, summary) values ($1,$2,$3)', [m.id, req.user!.id, 'Marcha creada'], c);
    return m;
  });
  res.json(m);
}));

libraryRouter.put('/marchas/:id', manage, h(async (req, res) => {
  const b = parse(marchaBody.partial(), req.body);
  await tx(async (c) => {
    const old = await one<any>('select * from marchas where id = $1 for update', [req.params.id], c);
    if (!old) throw new HttpError(404, 'Marcha no encontrada.');
    const diff: Record<string, [unknown, unknown]> = {};
    for (const f of FIELDS) if (f in b && String((b as any)[f] ?? '') !== String(old[f] ?? '')) diff[f] = [old[f], (b as any)[f]];
    const sets = FIELDS.filter((f) => f in b);
    if (sets.length) await q(`update marchas set ${sets.map((f, i) => `${f} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [req.params.id, ...sets.map((f) => (b as any)[f] ?? null)], c);
    if (b.tags) await setTags(req.params.id, b.tags, c);
    if (Object.keys(diff).length || b.tags) {
      await q('insert into marcha_changes(marcha_id, user_id, summary, diff) values ($1,$2,$3,$4)', [req.params.id, req.user!.id,
        Object.keys(diff).length ? `Ficha modificada: ${Object.keys(diff).join(', ')}` : 'Etiquetas actualizadas', JSON.stringify(diff)], c);
    }
  });
  hub.publish(`marcha:${req.params.id}`, { t: 'marcha:changed', marchaId: req.params.id });
  res.json({ ok: true });
}));

libraryRouter.delete('/marchas/:id', requirePerm('__director__'), h(async (req, res) => {
  await q('delete from marchas where id = $1', [req.params.id]);
  await audit(req.user!.id, 'delete', 'marcha', req.params.id);
  res.json({ ok: true });
}));

libraryRouter.put('/marchas/:id/favorite', h(async (req, res) => {
  const { favorite } = parse(z.object({ favorite: z.boolean() }), req.body);
  if (favorite) await q('insert into favorites values ($1,$2) on conflict do nothing', [req.user!.id, req.params.id]);
  else await q('delete from favorites where user_id = $1 and marcha_id = $2', [req.user!.id, req.params.id]);
  res.json({ ok: true });
}));

libraryRouter.post('/folders', manage, h(async (req, res) => {
  const b = parse(z.object({ name: z.string().min(1).max(80), parent_id: z.number().int().nullable().optional() }), req.body);
  res.json(await one('insert into folders(name, parent_id) values ($1,$2) returning *', [b.name, b.parent_id ?? null]));
}));
libraryRouter.delete('/folders/:id', manage, h(async (req, res) => {
  await q('delete from folders where id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ===== Partituras visuales (PDF / imagen) por instrumento y voz =====
libraryRouter.post('/marchas/:id/parts', manage, upload.single('file'), h(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Falta el archivo de la partitura.');
  const b = parse(z.object({
    label: z.string().min(1).max(120),
    instrument_id: z.coerce.number().int().optional().nullable(),
    voice_id: z.coerce.number().int().optional().nullable(),
    arrangement: z.string().max(120).optional(),
    page_count: z.coerce.number().int().min(1).max(500).optional(),
    replaces_part_id: z.string().uuid().optional(),
  }), Object.fromEntries(Object.entries(req.body).filter(([, v]) => v !== '')));
  if (b.voice_id && !b.instrument_id) throw new HttpError(400, 'Indica el instrumento de la voz.');
  if (b.voice_id) {
    const ok = await one('select 1 from voices where id = $1 and instrument_id = $2', [b.voice_id, b.instrument_id]);
    if (!ok) throw new HttpError(400, 'La voz no pertenece al instrumento indicado.');
  }
  const part = await tx(async (c) => {
    const f = await storeFile(req.file!.buffer, req.file!.originalname, req.user!.id, ['pdf', 'image'], c);
    let version = 1;
    if (b.replaces_part_id) {
      const old = await one<any>('select * from parts where id = $1 and marcha_id = $2 for update', [b.replaces_part_id, req.params.id], c);
      if (!old) throw new HttpError(404, 'La partitura a sustituir no existe.');
      version = old.version + 1;
      await q('update parts set active = false where id = $1', [old.id], c);
    } else {
      const dup = await one<any>(`select id from parts where marcha_id = $1 and active and instrument_id is not distinct from $2 and voice_id is not distinct from $3`, [req.params.id, b.instrument_id ?? null, b.voice_id ?? null], c);
      if (dup && b.instrument_id) throw new HttpError(409, 'Ya existe una partitura activa para ese instrumento y voz. Usa «Sustituir» para crear una nueva versión.');
    }
    const p = await one<any>(`insert into parts(marcha_id, instrument_id, voice_id, label, arrangement, file_id, page_count, version, replaces_part_id, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [req.params.id, b.instrument_id ?? null, b.voice_id ?? null, b.label, b.arrangement ?? null, f.id, b.page_count ?? null, version, b.replaces_part_id ?? null, req.user!.id], c);
    if (b.replaces_part_id) {
      // el mapa de compases se conserva si la nueva versión tiene la misma maquetación; la dirección puede revisarlo
      await q('insert into part_measures(part_id, measure, page, x, y, w, h) select $1, measure, page, x, y, w, h from part_measures where part_id = $2', [p.id, b.replaces_part_id], c);
    }
    await q('insert into marcha_changes(marcha_id, user_id, summary) values ($1,$2,$3)', [req.params.id, req.user!.id,
      b.replaces_part_id ? `Partitura «${b.label}» sustituida (versión ${version})` : `Partitura «${b.label}» añadida`], c);
    return one<any>(`${PART_SELECT} where p.id = $1`, [p.id], c);
  });
  hub.publish(`marcha:${req.params.id}`, { t: 'parts:changed', marchaId: req.params.id, partId: part.id, replaces: b.replaces_part_id ?? null });
  hub.toAll({ t: 'parts:changed', marchaId: req.params.id, partId: part.id, replaces: b.replaces_part_id ?? null });
  res.json(part);
}));

/**
 * Libreto: un PDF con muchas marchas de un mismo instrumento y voz. La dirección revisa en el navegador
 * qué páginas son de cada marcha; el PDF se guarda una sola vez, sin modificarlo, y cada marcha apunta a su
 * tramo de páginas. Se crea la marcha si no existe (se busca por título) y se añade —o se versiona— su partitura.
 */
libraryRouter.post('/import-book', manage, upload.single('file'), h(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Falta el PDF del libreto.');
  const b = parse(z.object({
    label: z.string().min(1).max(120),
    instrument_id: z.coerce.number().int(),
    voice_id: z.coerce.number().int().optional().nullable(),
    arrangement: z.string().max(120).optional(),
    entries: z.string().transform((s, ctx) => {
      try { return JSON.parse(s); } catch { ctx.addIssue({ code: 'custom', message: 'Lista de marchas no válida.' }); return z.NEVER; }
    }).pipe(z.array(z.object({ title: z.string().trim().min(1).max(200), composer: z.string().trim().max(200).optional().default(''),
      from: z.number().int().min(1), to: z.number().int().min(1) })).min(1).max(300)),
  }), Object.fromEntries(Object.entries(req.body).filter(([, v]) => v !== '')));
  if (b.voice_id) {
    const ok = await one('select 1 from voices where id = $1 and instrument_id = $2', [b.voice_id, b.instrument_id]);
    if (!ok) throw new HttpError(400, 'La voz no pertenece al instrumento indicado.');
  } else if (!(await one('select 1 from instruments where id = $1', [b.instrument_id]))) throw new HttpError(400, 'Instrumento no válido.');
  const b2 = parse(z.object({ page_count: z.coerce.number().int().min(1).max(2000) }), req.body);
  const err = validateBook(b.entries, b2.page_count);
  if (err) throw new HttpError(400, err);
  const results = await tx(async (c) => {
    const f = await storeFile(req.file!.buffer, req.file!.originalname, req.user!.id, ['pdf'], c);
    const out: { marcha_id: string; title: string; status: 'creada' | 'añadida' | 'nueva_version'; pages: number; replaces: string | null }[] = [];
    for (const e of b.entries) {
      let m = await one<any>('select id, composer from marchas where not is_demo and unaccent_lower(title) = unaccent_lower($1) order by created_at limit 1', [e.title], c);
      let status: 'creada' | 'añadida' | 'nueva_version' = 'añadida';
      if (!m) {
        m = await one<any>('insert into marchas(title, composer, created_by) values ($1,$2,$3) returning id', [e.title, e.composer || null, req.user!.id], c);
        await q('insert into marcha_changes(marcha_id, user_id, summary) values ($1,$2,$3)', [m.id, req.user!.id, 'Marcha creada al importar un libreto'], c);
        status = 'creada';
      } else if (!m.composer && e.composer) await q('update marchas set composer = $2, updated_at = now() where id = $1', [m.id, e.composer], c);
      const old = await one<any>(`select id, version from parts where marcha_id = $1 and active and instrument_id = $2 and voice_id is not distinct from $3 for update`, [m.id, b.instrument_id, b.voice_id ?? null], c);
      if (old) { await q('update parts set active = false where id = $1', [old.id], c); if (status !== 'creada') status = 'nueva_version'; }
      await q(`insert into parts(marcha_id, instrument_id, voice_id, label, arrangement, file_id, page_count, page_from, page_to, version, replaces_part_id, created_by)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [m.id, b.instrument_id, b.voice_id ?? null, b.label, b.arrangement ?? null, f.id, e.to - e.from + 1, e.from, e.to, old ? old.version + 1 : 1, old?.id ?? null, req.user!.id], c);
      await q('insert into marcha_changes(marcha_id, user_id, summary) values ($1,$2,$3)', [m.id, req.user!.id,
        old ? `Partitura «${b.label}» sustituida desde un libreto (versión ${old.version + 1})` : `Partitura «${b.label}» añadida desde un libreto`], c);
      out.push({ marcha_id: m.id, title: e.title, status, pages: e.to - e.from + 1, replaces: old?.id ?? null });
    }
    await audit(req.user!.id, 'import_book', 'library', null, { file: req.file!.originalname, label: b.label, count: out.length }, c);
    return out;
  });
  for (const r of results) hub.toAll({ t: 'parts:changed', marchaId: r.marcha_id, replaces: r.replaces });
  res.json({ results });
}));

libraryRouter.get('/parts/:id', h(async (req, res) => {
  const p = await one<any>(`${PART_SELECT} where p.id = $1`, [req.params.id]);
  if (!p) throw new HttpError(404, 'Partitura no encontrada.');
  const measures = await q('select measure, page, x, y, w, h from part_measures where part_id = $1 order by measure', [p.id]);
  const marcha = await one<any>('select id, title, measures from marchas where id = $1', [p.marcha_id]);
  const newer = p.active ? null : await one<any>(`select id, version from parts where marcha_id = $1 and active and instrument_id is not distinct from $2 and voice_id is not distinct from $3`, [p.marcha_id, p.instrument_id, p.voice_id]);
  q(`insert into material_usage(user_id, kind, ref_id) values ($1,'parte',$2)`, [req.user!.id, p.id]).catch(() => {});
  res.json({ ...p, measures_map: measures, marcha, newer });
}));

libraryRouter.put('/parts/:id', manage, h(async (req, res) => {
  const b = parse(z.object({ label: z.string().min(1).max(120).optional(), page_count: z.number().int().min(1).max(500).optional(),
    instrument_id: z.number().int().nullable().optional(), voice_id: z.number().int().nullable().optional(), arrangement: z.string().max(120).nullable().optional() }), req.body);
  if (b.voice_id != null) {
    const ok = await one('select 1 from voices where id = $1 and instrument_id = $2', [b.voice_id, b.instrument_id]);
    if (!ok) throw new HttpError(400, 'La voz no pertenece al instrumento indicado.');
  }
  const p = await one<any>(`update parts set label = coalesce($2,label), page_count = coalesce($3,page_count),
     instrument_id = case when $6 then $4 else instrument_id end, voice_id = case when $6 then $5 else voice_id end, arrangement = coalesce($7, arrangement)
     where id = $1 returning marcha_id, label`, [req.params.id, b.label ?? null, b.page_count ?? null, b.instrument_id ?? null, b.voice_id ?? null, 'instrument_id' in b, b.arrangement ?? null]);
  if (!p) throw new HttpError(404, 'Partitura no encontrada.');
  if ('instrument_id' in b) await q('insert into marcha_changes(marcha_id, user_id, summary) values ($1,$2,$3)', [p.marcha_id, req.user!.id, `Asignación de la partitura «${p.label}» modificada`]);
  res.json({ ok: true });
}));

libraryRouter.delete('/parts/:id', manage, h(async (req, res) => {
  const p = await one<any>('update parts set active = false where id = $1 returning marcha_id, label', [req.params.id]);
  if (p) await q('insert into marcha_changes(marcha_id, user_id, summary) values ($1,$2,$3)', [p.marcha_id, req.user!.id, `Partitura «${p.label}» retirada`]);
  res.json({ ok: true });
}));

/** Vinculación manual de compases sobre el PDF: permite saltar al mismo compás en cada parte. */
libraryRouter.put('/parts/:id/measures', manage, h(async (req, res) => {
  const list = parse(z.array(z.object({ measure: z.number().int().min(1).max(2000), page: z.number().int().min(1),
    x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) })).max(2000), req.body);
  await tx(async (c) => {
    await q('delete from part_measures where part_id = $1', [req.params.id], c);
    for (const m of list) await q('insert into part_measures values ($1,$2,$3,$4,$5,$6,$7) on conflict (part_id, measure) do update set page=excluded.page, x=excluded.x, y=excluded.y, w=excluded.w, h=excluded.h', [req.params.id, m.measure, m.page, m.x, m.y, m.w, m.h], c);
  });
  const p = await one<any>('select marcha_id from parts where id = $1', [req.params.id]);
  hub.publish(`part:${req.params.id}`, { t: 'part:measures', partId: req.params.id });
  res.json({ ok: true, count: list.length, marchaId: p?.marcha_id });
}));

libraryRouter.get('/marchas/:id/my-part', h(async (req, res) => {
  res.json(await resolvePart(req.user!.id, req.params.id, { eventId: (req.query.event as string) || null, assignmentId: req.query.assignment ? Number(req.query.assignment) : null }));
}));

// Vista para la dirección: qué parte recibiría cada componente activo
libraryRouter.get('/marchas/:id/coverage', requirePerm('library.manage'), h(async (req, res) => {
  const users = await q<any>(`select id, name from users where status = 'active' order by name`);
  const out = [];
  for (const u of users) {
    const r = await resolvePart(u.id, req.params.id, { eventId: (req.query.event as string) || null });
    out.push({ user_id: u.id, name: u.name, status: r.status, assignment: r.assignment ? `${r.assignment.instrument}${r.assignment.voice ? ' · ' + r.assignment.voice : ''}` : null, part: r.part?.label ?? null, score: r.score?.label ?? null });
  }
  res.json(out);
}));

// ===== Grabaciones =====
libraryRouter.post('/marchas/:id/recordings', manage, upload.single('file'), h(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Falta el archivo de audio.');
  const b = parse(z.object({ label: z.string().min(1).max(120), kind: z.enum(['banda', 'pista', 'referencia']).default('banda'),
    instrument_id: z.coerce.number().int().optional(), voice_id: z.coerce.number().int().optional() }), Object.fromEntries(Object.entries(req.body).filter(([, v]) => v !== '')));
  const r = await tx(async (c) => {
    const f = await storeFile(req.file!.buffer, req.file!.originalname, req.user!.id, ['audio'], c);
    const r = await one<any>('insert into recordings(marcha_id, label, kind, instrument_id, voice_id, file_id) values ($1,$2,$3,$4,$5,$6) returning *',
      [req.params.id, b.label, b.kind, b.instrument_id ?? null, b.voice_id ?? null, f.id], c);
    await q('insert into marcha_changes(marcha_id, user_id, summary) values ($1,$2,$3)', [req.params.id, req.user!.id, `Grabación «${b.label}» añadida`], c);
    return r;
  });
  res.json(r);
}));
libraryRouter.delete('/recordings/:id', manage, h(async (req, res) => {
  await q('delete from recordings where id = $1', [req.params.id]);
  res.json({ ok: true });
}));
