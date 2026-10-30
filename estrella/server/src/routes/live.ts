import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { q, one, tx } from '../db.ts';
import { h, parse, HttpError } from '../lib/http.ts';
import { requireAuth, requirePerm, can, isStaff } from '../lib/auth.ts';
import { hub } from '../realtime.ts';
import { resolvePart } from './library.ts';
import { convokedMembers } from './events.ts';

export const liveRouter = Router();
liveRouter.use(requireAuth);
const director = requirePerm('live.direct');

/** Margen con el que se programan los arranques: da tiempo a que la orden llegue a todos los dispositivos. */
export const START_LEAD_MS = 1500;

export interface LiveState {
  marchaId: string | null;
  marchaTitle: string | null;
  measure: number;
  totalMeasures: number | null;
  section: { name: string; from: number; to: number | null } | null;
  loop: { from: number; to: number } | null;
  transport: { status: 'stopped' | 'playing' | 'paused'; anchorTs: number; anchorMeasure: number };
  tempo: number;
  beatsPerMeasure: number;
  metronome: boolean;
  follow: boolean;
  silent: boolean;
  showAnnotations: boolean;
  view: 'auto' | 'pdf' | 'score';
  highlight: { measure: number; noteId?: string | null } | null;
  messages: { id: string; text: string; at: number; audience: { scope: 'all' } | { scope: 'sections'; sections: number[]; label?: string } }[];
  planItemId: string | null;
  lastCommand: { type: string; at: number; by: string } | null;
}

export function initialState(): LiveState {
  return {
    marchaId: null, marchaTitle: null, measure: 1, totalMeasures: null, section: null, loop: null,
    transport: { status: 'stopped', anchorTs: 0, anchorMeasure: 1 },
    tempo: 80, beatsPerMeasure: 2, metronome: false, follow: true, silent: false, showAnnotations: true, view: 'auto',
    highlight: null, messages: [], planItemId: null, lastCommand: null,
  };
}

/** Posición musical (en compases, fraccionaria) en un instante dado del reloj del servidor. */
export function positionAt(s: LiveState, ts: number): number {
  const t = s.transport;
  if (t.status !== 'playing') return t.anchorMeasure;
  const elapsed = Math.max(0, ts - t.anchorTs);
  let pos = t.anchorMeasure + (elapsed / 1000) * (s.tempo / 60) / s.beatsPerMeasure;
  if (s.loop && pos >= s.loop.to + 1) {
    const len = s.loop.to + 1 - s.loop.from;
    pos = s.loop.from + ((pos - s.loop.from) % len);
  }
  return pos;
}

const cmdSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('select_marcha'), marchaId: z.string().uuid() }),
  z.object({ type: z.literal('play'), fromMeasure: z.number().int().min(1).optional() }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }),
  z.object({ type: z.literal('stop') }),
  z.object({ type: z.literal('measure'), measure: z.number().int().min(1).max(2000) }),
  z.object({ type: z.literal('step'), delta: z.number().int().min(-50).max(50) }),
  z.object({ type: z.literal('loop'), loop: z.object({ from: z.number().int().min(1), to: z.number().int().min(1) }).nullable() }),
  z.object({ type: z.literal('section'), section: z.object({ name: z.string().max(60), from: z.number().int().min(1), to: z.number().int().min(1).nullable() }).nullable() }),
  z.object({ type: z.literal('tempo'), tempo: z.number().int().min(20).max(300) }),
  z.object({ type: z.literal('meter'), beatsPerMeasure: z.number().int().min(1).max(16) }),
  z.object({ type: z.literal('metronome'), on: z.boolean() }),
  z.object({ type: z.literal('follow'), on: z.boolean() }),
  z.object({ type: z.literal('silent'), on: z.boolean() }),
  z.object({ type: z.literal('annotations'), on: z.boolean() }),
  z.object({ type: z.literal('view'), view: z.enum(['auto', 'pdf', 'score']) }),
  z.object({ type: z.literal('highlight'), highlight: z.object({ measure: z.number().int().min(1), noteId: z.string().max(64).nullable().optional() }).nullable() }),
  z.object({ type: z.literal('message'), text: z.string().min(1).max(300), audience: z.union([z.object({ scope: z.literal('all') }), z.object({ scope: z.literal('sections'), sections: z.array(z.number().int()).min(1), label: z.string().max(60).optional() })]) }),
  z.object({ type: z.literal('clear_messages') }),
  z.object({ type: z.literal('plan_item'), itemId: z.string().uuid() }),
]);
type Cmd = z.infer<typeof cmdSchema>;

async function marchaInfo(marchaId: string) {
  const m = await one<any>('select id, title, measures from marchas where id = $1', [marchaId]);
  if (!m) throw new HttpError(404, 'Marcha no encontrada.');
  // si hay partitura estructurada publicada, se toman tempo y compás de referencia
  const sc = await one<any>(`select sv.content->'time' as time, (sv.content->>'tempo')::int as tempo, jsonb_array_length(sv.content->'measures') as n
    from scores s join score_versions sv on sv.id = s.published_version_id where s.marcha_id = $1 limit 1`, [marchaId]);
  return { ...m, time: sc?.time ?? null, tempo: sc?.tempo ?? null, scoreMeasures: sc?.n ?? null };
}

export async function applyCommand(s: LiveState, cmd: Cmd, now: number): Promise<LiveState> {
  const n: LiveState = structuredClone(s);
  const clampM = (m: number) => Math.max(1, n.totalMeasures ? Math.min(n.totalMeasures, m) : m);
  const reanchor = (m: number) => {
    // si suena, se reprograma con margen para que todos entren a la vez
    n.transport = n.transport.status === 'playing' ? { status: 'playing', anchorTs: now + START_LEAD_MS, anchorMeasure: m } : { ...n.transport, anchorMeasure: m };
  };
  switch (cmd.type) {
    case 'select_marcha': {
      const m = await marchaInfo(cmd.marchaId);
      n.marchaId = m.id; n.marchaTitle = m.title; n.totalMeasures = m.measures ?? m.scoreMeasures ?? null;
      n.measure = 1; n.section = null; n.loop = null; n.highlight = null;
      n.transport = { status: 'stopped', anchorTs: now, anchorMeasure: 1 };
      if (m.tempo) n.tempo = m.tempo;
      if (Array.isArray(m.time)) n.beatsPerMeasure = Number(m.time[0]) || n.beatsPerMeasure;
      break;
    }
    case 'play': {
      if (!n.marchaId) throw new HttpError(400, 'Selecciona primero una marcha.');
      const from = clampM(cmd.fromMeasure ?? n.loop?.from ?? n.measure);
      n.measure = from;
      n.transport = { status: 'playing', anchorTs: now + START_LEAD_MS, anchorMeasure: from };
      break;
    }
    case 'pause': {
      const pos = positionAt(n, now);
      n.measure = clampM(Math.floor(pos));
      n.transport = { status: 'paused', anchorTs: now, anchorMeasure: pos };
      break;
    }
    case 'resume': {
      const from = n.transport.anchorMeasure;
      n.transport = { status: 'playing', anchorTs: now + START_LEAD_MS, anchorMeasure: from };
      break;
    }
    case 'stop':
      n.measure = clampM(n.loop?.from ?? n.section?.from ?? 1);
      n.transport = { status: 'stopped', anchorTs: now, anchorMeasure: n.measure };
      break;
    case 'measure':
      n.measure = clampM(cmd.measure); reanchor(n.measure); n.highlight = { measure: n.measure };
      break;
    case 'step': {
      const cur = n.transport.status === 'playing' ? Math.floor(positionAt(n, now)) : n.measure;
      n.measure = clampM(cur + cmd.delta); reanchor(n.measure); n.highlight = { measure: n.measure };
      break;
    }
    case 'loop':
      if (cmd.loop && cmd.loop.to < cmd.loop.from) throw new HttpError(400, 'El compás final debe ser mayor o igual que el inicial.');
      n.loop = cmd.loop;
      if (cmd.loop) { n.measure = cmd.loop.from; reanchor(cmd.loop.from); }
      break;
    case 'section':
      n.section = cmd.section;
      if (cmd.section) { n.measure = clampM(cmd.section.from); reanchor(n.measure); n.highlight = { measure: n.measure }; }
      break;
    case 'tempo': {
      if (n.transport.status === 'playing') {
        const pos = positionAt(n, now);
        n.tempo = cmd.tempo;
        n.transport = { status: 'playing', anchorTs: now, anchorMeasure: pos };
      } else n.tempo = cmd.tempo;
      break;
    }
    case 'meter': n.beatsPerMeasure = cmd.beatsPerMeasure; break;
    case 'metronome': n.metronome = cmd.on; break;
    case 'follow': n.follow = cmd.on; break;
    case 'silent': n.silent = cmd.on; break;
    case 'annotations': n.showAnnotations = cmd.on; break;
    case 'view': n.view = cmd.view; break;
    case 'highlight': n.highlight = cmd.highlight; if (cmd.highlight) n.measure = clampM(cmd.highlight.measure); break;
    case 'message':
      n.messages = [{ id: crypto.randomUUID(), text: cmd.text, at: now, audience: cmd.audience }, ...n.messages].slice(0, 10);
      break;
    case 'clear_messages': n.messages = []; break;
    case 'plan_item': {
      const it = await one<any>('select * from rehearsal_plan where id = $1', [cmd.itemId]);
      if (!it) throw new HttpError(404, 'Punto del plan no encontrado.');
      n.planItemId = it.id;
      if (it.marcha_id && it.marcha_id !== n.marchaId) {
        const sel = await applyCommand(n, { type: 'select_marcha', marchaId: it.marcha_id }, now);
        Object.assign(n, sel, { planItemId: it.id });
      }
      if (it.measure_from) {
        n.measure = it.measure_from;
        n.loop = it.measure_to ? { from: it.measure_from, to: it.measure_to } : null;
        n.section = { name: it.title, from: it.measure_from, to: it.measure_to ?? null };
        n.transport = { status: 'stopped', anchorTs: now, anchorMeasure: it.measure_from };
      }
      break;
    }
  }
  return n;
}

function publicSession(row: any) {
  return { id: row.id, event_id: row.event_id, director_id: row.director_id, director_name: row.director_name, active: row.active, started_at: row.started_at, ended_at: row.ended_at, version: row.version, state: row.state };
}
const SESSION_SELECT = `select l.*, u.name as director_name, e.title as event_title from live_sessions l join users u on u.id = l.director_id left join events e on e.id = l.event_id`;

liveRouter.get('/active', h(async (req, res) => {
  const rows = await q<any>(`${SESSION_SELECT} where l.active order by l.started_at desc`);
  res.json(rows.map((r) => ({ ...publicSession(r), event_title: r.event_title })));
}));

liveRouter.post('/', director, h(async (req, res) => {
  const b = parse(z.object({ event_id: z.string().uuid().nullable().optional() }), req.body);
  const s = await tx(async (c) => {
    // una única sesión activa por evento: se reutiliza si ya existe
    if (b.event_id) {
      const ex = await one<any>(`select id from live_sessions where event_id = $1 and active`, [b.event_id], c);
      if (ex) return ex;
    }
    return one<any>('insert into live_sessions(event_id, director_id, state) values ($1,$2,$3) returning id', [b.event_id ?? null, req.user!.id, JSON.stringify(initialState())], c);
  });
  hub.toAll({ t: 'live:started', sessionId: s.id, eventId: b.event_id ?? null, by: req.user!.name });
  res.json({ id: s.id });
}));

liveRouter.get('/:id', h(async (req, res) => {
  const r = await one<any>(`${SESSION_SELECT} where l.id = $1`, [req.params.id]);
  if (!r) throw new HttpError(404, 'Sesión no encontrada.');
  hub.liveVersions.set(r.id, r.version);
  res.json({ ...publicSession(r), event_title: r.event_title, serverTs: Date.now(), startLeadMs: START_LEAD_MS });
}));

/** Orden del director: se aplica sobre el estado guardado (bloqueo de fila), se versiona y se difunde. */
liveRouter.post('/:id/cmd', director, h(async (req, res) => {
  const cmd = parse(cmdSchema, req.body);
  const now = Date.now();
  const out = await tx(async (c) => {
    const row = await one<any>('select * from live_sessions where id = $1 for update', [req.params.id], c);
    if (!row) throw new HttpError(404, 'Sesión no encontrada.');
    if (!row.active) throw new HttpError(400, 'La sesión ha finalizado.');
    const state = await applyCommand({ ...initialState(), ...row.state }, cmd, now);
    state.lastCommand = { type: cmd.type, at: now, by: req.user!.name };
    const r = await one<any>('update live_sessions set state = $2, version = version + 1 where id = $1 returning version', [row.id, JSON.stringify(state)], c);
    if (cmd.type === 'select_marcha' && row.event_id) {
      // la marcha trabajada queda en el historial del evento
      await q('insert into event_repertoire(event_id, marcha_id, sort) values ($1,$2,(select coalesce(max(sort),0)+1 from event_repertoire where event_id=$1)) on conflict do nothing', [row.event_id, cmd.marchaId], c);
    }
    return { version: r.version as number, state };
  });
  hub.setLiveVersion(req.params.id, out.version);
  hub.publish(`live:${req.params.id}`, { t: 'live:state', sessionId: req.params.id, version: out.version, state: out.state, serverTs: now, cmd: cmd.type });
  res.json({ version: out.version, state: out.state, serverTs: now });
}));

liveRouter.post('/:id/end', director, h(async (req, res) => {
  await q('update live_sessions set active = false, ended_at = now() where id = $1', [req.params.id]);
  hub.publish(`live:${req.params.id}`, { t: 'live:ended', sessionId: req.params.id });
  hub.toAll({ t: 'live:ended', sessionId: req.params.id });
  res.json({ ok: true });
}));

/** Parte personalizada del componente para la marcha que ha enviado el director. */
liveRouter.get('/:id/my-part', h(async (req, res) => {
  const r = await one<any>('select state, event_id, version from live_sessions where id = $1', [req.params.id]);
  if (!r) throw new HttpError(404, 'Sesión no encontrada.');
  if (!r.state.marchaId) return res.json({ marchaId: null, version: r.version });
  const resolution = await resolvePart(req.user!.id, r.state.marchaId, { eventId: r.event_id, assignmentId: req.query.assignment ? Number(req.query.assignment) : null });
  res.json({ marchaId: r.state.marchaId, version: r.version, ...resolution });
}));

liveRouter.get('/:id/presence', h(async (req, res) => {
  if (!can(req.user, 'live.direct') && !isStaff(req.user)) throw new HttpError(403, 'Sin permiso.');
  res.json(hub.presenceList(req.params.id));
}));

/** Cobertura: qué parte recibe cada convocado (para que la dirección detecte partes que faltan). */
liveRouter.get('/:id/coverage', director, h(async (req, res) => {
  const r = await one<any>('select state, event_id from live_sessions where id = $1', [req.params.id]);
  if (!r?.state.marchaId) return res.json([]);
  const people = r.event_id ? await convokedMembers(r.event_id) : await q<any>(`select id, name from users where status = 'active' order by name`);
  const online = new Set(hub.presenceList(req.params.id).filter((p) => p.status !== 'desconectado').map((p) => p.userId));
  const out = [];
  for (const p of people) {
    const res2 = await resolvePart(p.id, r.state.marchaId, { eventId: r.event_id });
    out.push({ user_id: p.id, name: p.name, online: online.has(p.id), status: res2.status,
      assignment: res2.assignment ? `${res2.assignment.instrument}${res2.assignment.voice ? ' · ' + res2.assignment.voice : ''}` : null,
      assignments: res2.assignments.map((a) => ({ id: a.id, label: `${a.instrument}${a.voice ? ' · ' + a.voice : ''}`, is_default: a.is_default })),
      part: res2.part?.label ?? null, score: res2.score?.label ?? null });
  }
  res.json(out);
}));

liveRouter.get('/:id/incidents', director, h(async (req, res) => {
  res.json(await q(`select l.kind, l.detail, l.at, u.name from live_device_log l left join users u on u.id = l.user_id where l.session_id = $1 order by l.at desc limit 200`, [req.params.id]));
}));
