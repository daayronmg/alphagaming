import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { q, one, tx, audit } from '../db.ts';
import { h, parse, HttpError } from '../lib/http.ts';
import { requireAuth, requirePerm, can } from '../lib/auth.ts';
import { upload, storeFile, fileRow, filePath, canAccessFile } from '../lib/files.ts';
import { config } from '../config.ts';
import { hub } from '../realtime.ts';
import { validateScore, diffScores, type ScoreDoc } from '../../../shared/music.ts';

export const scoresRouter = Router();
scoresRouter.use(requireAuth);
const publisher = requirePerm('scores.publish');

async function scoreMeta(id: string) {
  return one<any>(`select s.*, m.title as marcha_title, i.name as instrument, v.name as voice, sv.number as version_number,
      sv.created_at as published_at, au.name as published_by, du.name as draft_updated_by_name
    from scores s join marchas m on m.id = s.marcha_id left join instruments i on i.id = s.instrument_id left join voices v on v.id = s.voice_id
    left join score_versions sv on sv.id = s.published_version_id left join users au on au.id = sv.author_id left join users du on du.id = s.draft_updated_by
    where s.id = $1`, [id]);
}

scoresRouter.get('/:id', h(async (req, res) => {
  const s = await scoreMeta(req.params.id);
  if (!s) throw new HttpError(404, 'Partitura no encontrada.');
  const editor = can(req.user, 'scores.publish');
  const published = s.published_version_id ? await one<any>('select content from score_versions where id = $1', [s.published_version_id]) : null;
  if (!published && !editor) throw new HttpError(404, 'Esta partitura todavía no se ha publicado.');
  const versions = await q(`select sv.id, sv.number, sv.description, sv.changes, sv.created_at, sv.restored_from, u.name as author
    from score_versions sv left join users u on u.id = sv.author_id where sv.score_id = $1 order by sv.number desc`, [s.id]);
  res.json({
    id: s.id, marcha_id: s.marcha_id, marcha_title: s.marcha_title, label: s.label, instrument_id: s.instrument_id, instrument: s.instrument,
    voice_id: s.voice_id, voice: s.voice, part_id: s.part_id, source: s.source, source_file_id: s.source_file_id, needs_review: s.needs_review,
    published: published?.content ?? null, published_version_id: s.published_version_id, version_number: s.version_number, published_at: s.published_at, published_by: s.published_by,
    versions,
    ...(editor ? { draft: s.draft, draft_rev: s.draft_rev, draft_updated_at: s.draft_updated_at, draft_updated_by: s.draft_updated_by_name } : {}),
  });
}));

scoresRouter.get('/:id/versions/:vid', h(async (req, res) => {
  const v = await one<any>(`select sv.*, u.name as author from score_versions sv left join users u on u.id = sv.author_id where sv.id = $1 and sv.score_id = $2`, [req.params.vid, req.params.id]);
  if (!v) throw new HttpError(404, 'Versión no encontrada.');
  res.json(v);
}));

// Crear partitura editable: desde MusicXML (ya interpretado por el cliente, con el archivo original adjunto) o vacía
scoresRouter.post('/', publisher, upload.single('file'), h(async (req, res) => {
  const meta = parse(z.object({
    marcha_id: z.string().uuid(), label: z.string().min(1).max(120),
    instrument_id: z.number().int().nullable().optional(), voice_id: z.number().int().nullable().optional(), part_id: z.string().uuid().nullable().optional(),
    source: z.enum(['musicxml', 'manual']), content: z.any(),
  }), typeof req.body.payload === 'string' ? JSON.parse(req.body.payload) : req.body);
  const err = validateScore(meta.content);
  if (err) throw new HttpError(400, `Partitura no válida: ${err}`);
  const s = await tx(async (c) => {
    let fileId: string | null = null;
    if (req.file) fileId = (await storeFile(req.file.buffer, req.file.originalname, req.user!.id, ['musicxml'], c)).id;
    return one<any>(`insert into scores(marcha_id, instrument_id, voice_id, part_id, label, source, source_file_id, draft, draft_updated_by, draft_updated_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) returning id`,
      [meta.marcha_id, meta.instrument_id ?? null, meta.voice_id ?? null, meta.part_id ?? null, meta.label, meta.source, fileId, JSON.stringify(meta.content), req.user!.id], c);
  });
  await q('insert into marcha_changes(marcha_id, user_id, summary) values ($1,$2,$3)', [meta.marcha_id, req.user!.id, `Partitura editable «${meta.label}» creada (borrador)`]);
  res.json({ id: s.id });
}));

scoresRouter.put('/:id/meta', publisher, h(async (req, res) => {
  const b = parse(z.object({ label: z.string().min(1).max(120), instrument_id: z.number().int().nullable(), voice_id: z.number().int().nullable(), part_id: z.string().uuid().nullable(), needs_review: z.boolean() }), req.body);
  await q('update scores set label=$2, instrument_id=$3, voice_id=$4, part_id=$5, needs_review=$6 where id=$1', [req.params.id, b.label, b.instrument_id, b.voice_id, b.part_id, b.needs_review]);
  res.json({ ok: true });
}));

/** Guardado del borrador con control de concurrencia: si otra persona guardó antes, se devuelve conflicto (no se sobrescribe). */
scoresRouter.put('/:id/draft', publisher, h(async (req, res) => {
  const b = parse(z.object({ content: z.any(), rev: z.number().int() }), req.body);
  const err = validateScore(b.content);
  if (err) throw new HttpError(400, `Partitura no válida: ${err}`);
  const r = await one<any>(`update scores set draft = $2, draft_rev = draft_rev + 1, draft_updated_by = $3, draft_updated_at = now()
    where id = $1 and draft_rev = $4 returning draft_rev`, [req.params.id, JSON.stringify(b.content), req.user!.id, b.rev]);
  if (!r) {
    const cur = await scoreMeta(req.params.id);
    if (!cur) throw new HttpError(404, 'Partitura no encontrada.');
    return res.status(409).json({ error: `${cur.draft_updated_by_name ?? 'Otra persona'} ha guardado cambios en el borrador. Revisa su versión antes de continuar.`, draft: cur.draft, draft_rev: cur.draft_rev });
  }
  hub.publish(`score:${req.params.id}`, { t: 'score:draft', scoreId: req.params.id, rev: r.draft_rev, by: req.user!.name, byId: req.user!.id });
  res.json({ rev: r.draft_rev });
}));

async function publishContent(scoreId: string, content: ScoreDoc, description: string, userId: string, restoredFrom: string | null) {
  return tx(async (c) => {
    const s = await one<any>('select * from scores where id = $1 for update', [scoreId], c);
    if (!s) throw new HttpError(404, 'Partitura no encontrada.');
    const prev = s.published_version_id ? await one<any>('select id, number, content from score_versions where id = $1', [s.published_version_id], c) : null;
    const changes = diffScores(prev?.content ?? null, content);
    if (prev && changes.length === 0 && !restoredFrom) throw new HttpError(400, 'No hay cambios respecto a la versión publicada.');
    const last = await one<any>('select coalesce(max(number), 0) as n from score_versions where score_id = $1', [scoreId], c);
    const v = await one<any>(`insert into score_versions(score_id, number, content, author_id, description, changes, parent_version_id, restored_from)
      values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, number, created_at`,
      [scoreId, last.n + 1, JSON.stringify(content), userId, description, JSON.stringify(changes), prev?.id ?? null, restoredFrom], c);
    await q('update scores set published_version_id = $2, draft = $3, draft_rev = draft_rev + 1, needs_review = false where id = $1', [scoreId, v.id, JSON.stringify(content)], c);
    await q('insert into marcha_changes(marcha_id, user_id, summary, diff) values ($1,$2,$3,$4)', [s.marcha_id, userId,
      `Partitura «${s.label}» publicada: versión ${v.number}${restoredFrom ? ' (restaurada)' : ''} — ${description}`, JSON.stringify(changes)], c);
    await audit(userId, 'publish', 'score', scoreId, { version: v.number }, c);
    const msg = { t: 'score:published', scoreId, marchaId: s.marcha_id, versionId: v.id, number: v.number, description, changes };
    return { v, msg, changes };
  });
}

scoresRouter.post('/:id/publish', publisher, h(async (req, res) => {
  const b = parse(z.object({ description: z.string().min(3).max(500), rev: z.number().int().optional() }), req.body);
  const s = await one<any>('select draft, draft_rev from scores where id = $1', [req.params.id]);
  if (!s?.draft) throw new HttpError(400, 'No hay borrador que publicar.');
  if (b.rev != null && b.rev !== s.draft_rev) throw new HttpError(409, 'El borrador ha cambiado desde que lo abriste. Recárgalo antes de publicar.');
  const err = validateScore(s.draft);
  if (err) throw new HttpError(400, `Partitura no válida: ${err}`);
  const { v, msg, changes } = await publishContent(req.params.id, s.draft, b.description, req.user!.id, null);
  hub.publish(`score:${req.params.id}`, msg);
  hub.publish(`marcha:${msg.marchaId}`, msg);
  res.json({ id: v.id, number: v.number, changes });
}));

scoresRouter.post('/:id/restore', publisher, h(async (req, res) => {
  const b = parse(z.object({ version_id: z.string().uuid(), description: z.string().max(500).optional() }), req.body);
  const old = await one<any>('select content, number from score_versions where id = $1 and score_id = $2', [b.version_id, req.params.id]);
  if (!old) throw new HttpError(404, 'Versión no encontrada.');
  const { v, msg } = await publishContent(req.params.id, old.content, b.description || `Restaurada la versión ${old.number}`, req.user!.id, b.version_id);
  hub.publish(`score:${req.params.id}`, msg);
  hub.publish(`marcha:${msg.marchaId}`, msg);
  res.json({ id: v.id, number: v.number });
}));

scoresRouter.delete('/:id', requirePerm('__director__'), h(async (req, res) => {
  await q('delete from scores where id = $1', [req.params.id]);
  res.json({ ok: true });
}));

/**
 * Reconocimiento óptico (OMR) con Audiveris, si está instalado en el servidor (AUDIVERIS_PATH).
 * El resultado se guarda como MusicXML para que el cliente lo convierta en un BORRADOR marcado «requiere revisión».
 * Nunca se publica automáticamente.
 */
scoresRouter.post('/omr/:partId', publisher, h(async (req, res) => {
  if (!config.audiverisPath) {
    throw new HttpError(501, 'El reconocimiento automático (OMR) no está configurado en este servidor. Instala Audiveris y define AUDIVERIS_PATH, o importa un MusicXML exportado desde MuseScore/Sibelius/Finale, o transcribe la parte en el editor.');
  }
  const part = await one<any>('select p.*, f.storage_path, f.kind from parts p join files f on f.id = p.file_id where p.id = $1', [req.params.partId]);
  if (!part) throw new HttpError(404, 'Partitura no encontrada.');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'omr-'));
  const input = path.join(out, part.kind === 'pdf' ? 'entrada.pdf' : 'entrada.png');
  fs.copyFileSync(filePath(part.storage_path), input);
  const code: number = await new Promise((resolve) => {
    const p = spawn(config.audiverisPath, ['-batch', '-export', '-output', out, input], { stdio: 'ignore' });
    const t = setTimeout(() => p.kill('SIGKILL'), 5 * 60_000);
    p.on('close', (c) => { clearTimeout(t); resolve(c ?? 1); });
    p.on('error', () => resolve(1));
  });
  const find = (d: string): string | null => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, f.name);
      if (f.isDirectory()) { const r = find(full); if (r) return r; }
      else if (/\.(musicxml|xml)$/i.test(f.name)) return full;
    }
    return null;
  };
  const xml = code === 0 ? find(out) : null;
  if (!xml) { fs.rmSync(out, { recursive: true, force: true }); throw new HttpError(422, 'El reconocimiento no ha producido un resultado utilizable (posible escaneo de baja calidad o formato comprimido .mxl). Conserva el PDF original y transcribe manualmente.'); }
  const f = await storeFile(fs.readFileSync(xml), `omr-${part.label}.musicxml`, req.user!.id, ['musicxml']);
  fs.rmSync(out, { recursive: true, force: true });
  res.json({ file_id: f.id, warning: 'Resultado de reconocimiento automático: revisa todas las notas antes de publicar.' });
}));

scoresRouter.get('/source/:fileId', h(async (req, res) => {
  const f = await fileRow(req.params.fileId);
  if (!f || f.kind !== 'musicxml' || !(await canAccessFile(req.user!, f.id))) throw new HttpError(404, 'Archivo no encontrado.');
  res.type('application/xml').send(fs.readFileSync(filePath(f.storage_path)));
}));
