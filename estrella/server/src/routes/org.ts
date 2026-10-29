import { Router } from 'express';
import { z } from 'zod';
import { q, one, audit } from '../db.ts';
import { h, parse, HttpError } from '../lib/http.ts';
import { requireAuth, requirePerm, SECTION_PERMISSIONS } from '../lib/auth.ts';
import { upload, storeFile } from '../lib/files.ts';
import { hub } from '../realtime.ts';

export const orgRouter = Router();

export async function structure() {
  const sections = await q<any>('select * from sections order by sort, name');
  const instruments = await q<any>('select * from instruments order by sort, name');
  const voices = await q<any>('select * from voices order by sort, name');
  return sections.map((s) => ({
    ...s,
    instruments: instruments.filter((i) => i.section_id === s.id).map((i) => ({ ...i, voices: voices.filter((v) => v.instrument_id === i.id) })),
  }));
}

orgRouter.get('/branding', h(async (_req, res) => {
  const b = await one<any>(`select value from settings where key = 'branding'`);
  res.json(b?.value ?? {});
}));

orgRouter.use(requireAuth);

orgRouter.get('/structure', h(async (_req, res) => res.json(await structure())));

const manage = requirePerm('assignments.manage');
const sectionBody = z.object({ name: z.string().min(1).max(80), family: z.enum(['viento', 'percusion', 'otro']), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#c9a227'), sort: z.number().int().default(0) });
orgRouter.post('/sections', manage, h(async (req, res) => {
  const b = parse(sectionBody, req.body);
  const r = await one('insert into sections(name, family, color, sort) values ($1,$2,$3,$4) returning *', [b.name, b.family, b.color, b.sort]);
  await audit(req.user!.id, 'create', 'section', String((r as any).id), b);
  res.json(r);
}));
orgRouter.put('/sections/:id', manage, h(async (req, res) => {
  const b = parse(sectionBody, req.body);
  res.json(await one('update sections set name=$2, family=$3, color=$4, sort=$5 where id=$1 returning *', [req.params.id, b.name, b.family, b.color, b.sort]));
}));
orgRouter.delete('/sections/:id', manage, h(async (req, res) => {
  const used = await one(`select 1 from user_assignments a join instruments i on i.id=a.instrument_id where i.section_id=$1 limit 1`, [req.params.id]);
  if (used) throw new HttpError(409, 'Hay componentes asignados a esta sección. Cambia sus asignaciones antes de eliminarla.');
  await q('delete from sections where id=$1', [req.params.id]);
  await audit(req.user!.id, 'delete', 'section', req.params.id);
  res.json({ ok: true });
}));

const instBody = z.object({ section_id: z.number().int(), name: z.string().min(1).max(80), clef: z.enum(['treble', 'bass', 'percussion']), transposition: z.number().int().min(-24).max(24), sort: z.number().int().default(0) });
orgRouter.post('/instruments', manage, h(async (req, res) => {
  const b = parse(instBody, req.body);
  res.json(await one('insert into instruments(section_id, name, clef, transposition, sort) values ($1,$2,$3,$4,$5) returning *', [b.section_id, b.name, b.clef, b.transposition, b.sort]));
}));
orgRouter.put('/instruments/:id', manage, h(async (req, res) => {
  const b = parse(instBody, req.body);
  res.json(await one('update instruments set section_id=$2, name=$3, clef=$4, transposition=$5, sort=$6 where id=$1 returning *', [req.params.id, b.section_id, b.name, b.clef, b.transposition, b.sort]));
}));
orgRouter.delete('/instruments/:id', manage, h(async (req, res) => {
  if (await one('select 1 from user_assignments where instrument_id=$1 limit 1', [req.params.id])) throw new HttpError(409, 'Hay componentes con este instrumento asignado.');
  await q('delete from instruments where id=$1', [req.params.id]);
  res.json({ ok: true });
}));

const voiceBody = z.object({ instrument_id: z.number().int(), name: z.string().min(1).max(80), sort: z.number().int().default(0) });
orgRouter.post('/voices', manage, h(async (req, res) => {
  const b = parse(voiceBody, req.body);
  res.json(await one('insert into voices(instrument_id, name, sort) values ($1,$2,$3) returning *', [b.instrument_id, b.name, b.sort]));
}));
orgRouter.put('/voices/:id', manage, h(async (req, res) => {
  const b = parse(voiceBody, req.body);
  res.json(await one('update voices set instrument_id=$2, name=$3, sort=$4 where id=$1 returning *', [req.params.id, b.instrument_id, b.name, b.sort]));
}));
orgRouter.delete('/voices/:id', manage, h(async (req, res) => {
  if (await one('select 1 from user_assignments where voice_id=$1 limit 1', [req.params.id])) throw new HttpError(409, 'Hay componentes con esta voz asignada.');
  await q('delete from voices where id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// Responsables de sección (solo dirección)
orgRouter.get('/leaders', h(async (_req, res) => {
  res.json(await q(`select l.user_id, u.name, l.section_id, s.name as section, l.permissions from section_leaders l join users u on u.id=l.user_id join sections s on s.id=l.section_id order by s.sort, u.name`));
}));
orgRouter.put('/leaders', requirePerm('__director__'), h(async (req, res) => {
  const b = parse(z.object({ user_id: z.string().uuid(), section_id: z.number().int(), permissions: z.array(z.enum(Object.keys(SECTION_PERMISSIONS) as [string, ...string[]])) }), req.body);
  await q(`insert into section_leaders(user_id, section_id, permissions) values ($1,$2,$3) on conflict (user_id, section_id) do update set permissions = excluded.permissions`, [b.user_id, b.section_id, b.permissions]);
  await q(`update users set role = 'leader' where id = $1 and role = 'member'`, [b.user_id]);
  await audit(req.user!.id, 'set_leader', 'user', b.user_id, b);
  hub.toUser(b.user_id, { t: 'me:changed' });
  res.json({ ok: true });
}));
orgRouter.delete('/leaders/:userId/:sectionId', requirePerm('__director__'), h(async (req, res) => {
  await q('delete from section_leaders where user_id=$1 and section_id=$2', [req.params.userId, req.params.sectionId]);
  const still = await one('select 1 from section_leaders where user_id=$1', [req.params.userId]);
  if (!still) await q(`update users set role='member' where id=$1 and role='leader'`, [req.params.userId]);
  await audit(req.user!.id, 'unset_leader', 'user', req.params.userId, { section: req.params.sectionId });
  hub.toUser(req.params.userId, { t: 'me:changed' });
  res.json({ ok: true });
}));

// Identidad visual: nombre del sistema, nombre de la banda y logotipo oficial (lo sube la dirección)
orgRouter.put('/branding', requirePerm('__director__'), h(async (req, res) => {
  const b = parse(z.object({ appName: z.string().min(1).max(40), bandName: z.string().min(1).max(120), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), instagram: z.string().max(200).optional() }), req.body);
  const cur = (await one<any>(`select value from settings where key='branding'`))?.value ?? {};
  const value = { ...cur, ...b };
  await q(`insert into settings(key, value) values ('branding', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify(value)]);
  hub.toAll({ t: 'branding', value });
  res.json(value);
}));
orgRouter.post('/branding/logo', requirePerm('__director__'), upload.single('file'), h(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Falta el archivo.');
  const f = await storeFile(req.file.buffer, req.file.originalname, req.user!.id, ['image']);
  const cur = (await one<any>(`select value from settings where key='branding'`))?.value ?? {};
  const value = { ...cur, logoFileId: f.id };
  await q(`insert into settings(key, value) values ('branding', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify(value)]);
  hub.toAll({ t: 'branding', value });
  res.json(value);
}));
