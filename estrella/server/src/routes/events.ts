import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { q, one, tx, audit } from '../db.ts';
import { h, parse, HttpError } from '../lib/http.ts';
import { requireAuth, requirePerm, can, sectionsWith, isStaff, randomToken, type AuthUser } from '../lib/auth.ts';
import { hub } from '../realtime.ts';
import { toCsv } from '../lib/csv.ts';
import { sendRsvpInvites } from '../lib/rsvpMail.ts';

export const eventsRouter = Router();
eventsRouter.use(requireAuth);
const manage = requirePerm('events.manage');

const EVENT_TYPES = ['ensayo', 'actuacion', 'concierto', 'procesion', 'otro'] as const;
const ATT_STATUS = ['presente', 'ausente', 'retraso', 'justificada', 'pendiente'] as const;

function convoked(user: AuthUser, e: { section_ids: number[] }) {
  return e.section_ids.length === 0 || e.section_ids.some((s) => user.sectionIds.includes(s));
}

/** Componentes convocados a un evento (activos y con asignación en las secciones convocadas). */
export async function convokedMembers(eventId: string) {
  return q<any>(`
    select u.id, u.name, coalesce(min(i.section_id), 0) as section_id, min(s.name) as section,
      string_agg(distinct i.name || coalesce(' · ' || v.name, ''), ', ') as assignment
    from users u join events e on e.id = $1
    left join user_assignments a on a.user_id = u.id left join instruments i on i.id = a.instrument_id
    left join sections s on s.id = i.section_id left join voices v on v.id = a.voice_id
    where u.status = 'active' and (cardinality(e.section_ids) = 0 or i.section_id = any(e.section_ids))
    group by u.id order by min(s.sort), u.name`, [eventId]);
}

eventsRouter.get('/', h(async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 31 * 864e5);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 120 * 864e5);
  const rows = await q<any>(`select e.*, r.response as my_rsvp, att.status as my_attendance, u.name as responsible_name,
      (select count(*) from event_repertoire er where er.event_id = e.id)::int as repertoire_count,
      exists (select 1 from live_sessions l where l.event_id = e.id and l.active) as live
    from events e left join event_rsvp r on r.event_id = e.id and r.user_id = $3
    left join attendance att on att.event_id = e.id and att.user_id = $3
    left join users u on u.id = e.responsible_id
    where e.starts_at between $1 and $2 order by e.starts_at`, [from, to, req.user!.id]);
  const user = req.user!;
  res.json(rows.filter((e) => isStaff(user) || can(user, 'events.manage') || convoked(user, e)).map(({ checkin_secret, summary, ...e }) => ({ ...e, convoked: convoked(user, e), has_summary: !!summary })));
}));

eventsRouter.get('/:id', h(async (req, res) => {
  const e = await one<any>(`select e.*, u.name as responsible_name from events e left join users u on u.id = e.responsible_id where e.id = $1`, [req.params.id]);
  if (!e) throw new HttpError(404, 'Evento no encontrado.');
  const user = req.user!;
  if (!isStaff(user) && !can(user, 'events.manage') && !convoked(user, e)) throw new HttpError(404, 'Evento no encontrado.');
  const { checkin_secret, ...pub } = e;
  const repertoire = await q(`select m.id, m.title, m.composer, m.difficulty, er.sort from event_repertoire er join marchas m on m.id = er.marcha_id where er.event_id = $1 order by er.sort`, [e.id]);
  const plan = await q(`select p.*, m.title as marcha_title from rehearsal_plan p left join marchas m on m.id = p.marcha_id where p.event_id = $1 order by p.sort`, [e.id]);
  const passages = await q(`select pw.*, m.title as marcha_title, u.name as by_name from passage_work pw join marchas m on m.id = pw.marcha_id left join users u on u.id = pw.created_by where pw.event_id = $1 order by pw.created_at`, [e.id]);
  const my = {
    rsvp: await one('select response, reason, updated_at from event_rsvp where event_id = $1 and user_id = $2', [e.id, user.id]),
    attendance: await one('select status, minutes_late, method, recorded_at from attendance where event_id = $1 and user_id = $2', [e.id, user.id]),
  };
  const live = await one(`select id, started_at from live_sessions where event_id = $1 and active`, [e.id]);
  const out: any = { ...pub, repertoire, plan, passages, my, live, convoked: convoked(user, e) };
  const attSecs = sectionsWith(user, 'attendance', 'events.manage');
  if (attSecs === 'all' || attSecs.length) {
    const roster = await convokedMembers(e.id);
    const rsvps = await q<any>('select * from event_rsvp where event_id = $1', [e.id]);
    const att = await q<any>('select a.*, u.name as recorded_by_name from attendance a left join users u on u.id = a.recorded_by where a.event_id = $1', [e.id]);
    out.roster = roster.filter((m) => attSecs === 'all' || attSecs.includes(m.section_id)).map((m) => ({
      ...m, rsvp: rsvps.find((r) => r.user_id === m.id) ?? null, attendance: att.find((a) => a.user_id === m.id) ?? null,
    }));
    out.can_record = true;
  }
  if (can(user, 'events.manage') || can(user, 'live.direct')) {
    out.overrides = await q('select o.user_id, o.assignment_id from event_assignment_overrides o where o.event_id = $1', [e.id]);
  }
  res.json(out);
}));

const eventBody = z.object({
  type: z.enum(EVENT_TYPES), title: z.string().min(2).max(160),
  starts_at: z.string().datetime({ offset: true }), call_at: z.string().datetime({ offset: true }).nullable().optional(), ends_at: z.string().datetime({ offset: true }).nullable().optional(),
  location: z.string().max(200).nullable().optional(), uniform: z.string().max(500).nullable().optional(), notes: z.string().max(3000).nullable().optional(),
  responsible_id: z.string().uuid().nullable().optional(), section_ids: z.array(z.number().int()).default([]),
  repertoire: z.array(z.string().uuid()).max(60).optional(),
  status: z.enum(['programado', 'cancelado', 'finalizado']).optional(),
  notify: z.boolean().optional(), // false: no mandar la convocatoria por correo
});

eventsRouter.post('/', manage, h(async (req, res) => {
  const b = parse(eventBody, req.body);
  const e = await tx(async (c) => {
    const e = await one<any>(`insert into events(type, title, starts_at, call_at, ends_at, location, uniform, notes, responsible_id, section_ids, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [b.type, b.title, b.starts_at, b.call_at ?? null, b.ends_at ?? null, b.location ?? null, b.uniform ?? null, b.notes ?? null, b.responsible_id ?? null, b.section_ids, req.user!.id], c);
    for (const [i, m] of (b.repertoire ?? []).entries()) await q('insert into event_repertoire values ($1,$2,$3)', [e.id, m, i], c);
    return e;
  });
  hub.toAll({ t: 'events:changed', eventId: e.id });
  res.json(e);
  // convocatoria por correo a cada componente (en segundo plano: no hace esperar a la dirección)
  if (b.notify !== false) sendRsvpInvites(e.id).catch((x) => console.error('[convocatoria]', x));
}));

eventsRouter.put('/:id', manage, h(async (req, res) => {
  const b = parse(eventBody.partial(), req.body);
  const old = await one<any>('select * from events where id = $1', [req.params.id]);
  if (!old) throw new HttpError(404, 'Evento no encontrado.');
  await tx(async (c) => {
    const fields = ['type', 'title', 'starts_at', 'call_at', 'ends_at', 'location', 'uniform', 'notes', 'responsible_id', 'section_ids', 'status'].filter((f) => f in b);
    if (fields.length) await q(`update events set ${fields.map((f, i) => `${f} = $${i + 2}`).join(', ')} where id = $1`, [req.params.id, ...fields.map((f) => (b as any)[f] ?? null)], c);
    if (b.repertoire) {
      await q('delete from event_repertoire where event_id = $1', [req.params.id], c);
      for (const [i, m] of b.repertoire.entries()) await q('insert into event_repertoire values ($1,$2,$3)', [req.params.id, m, i], c);
    }
  });
  // Cambio de última hora: si cambia hora, lugar o se cancela un evento próximo, se avisa como urgente
  const soon = new Date(old.starts_at).getTime() - Date.now() < 72 * 3600_000;
  const changed = (b.starts_at && new Date(b.starts_at).getTime() !== new Date(old.starts_at).getTime()) || (b.call_at && old.call_at && new Date(b.call_at).getTime() !== new Date(old.call_at).getTime()) || (b.location && b.location !== old.location) || (b.status === 'cancelado' && old.status !== 'cancelado');
  if (soon && changed) {
    const text = b.status === 'cancelado' ? `${old.title}: CANCELADO` : `${old.title}: cambio de ${b.location && b.location !== old.location ? 'lugar' : 'horario'}`;
    await q('update events set last_minute = $2, last_minute_at = now() where id = $1', [req.params.id, text]);
    const a = await one<any>(`insert into announcements(title, body, urgent, category, section_ids, author_id, event_id) values ($1,$2,true,'cambio',$3,$4,$5) returning *`,
      ['Cambio de última hora', text, old.section_ids, req.user!.id, req.params.id]);
    hub.toAll({ t: 'announcement', announcement: { ...a, author_name: req.user!.name } }, (c) => old.section_ids.length === 0 || old.section_ids.some((s: number) => c.user.sectionIds.includes(s)) || isStaff(c.user));
  }
  hub.toAll({ t: 'events:changed', eventId: req.params.id });
  res.json({ ok: true });
}));

eventsRouter.delete('/:id', manage, h(async (req, res) => {
  await q('delete from events where id = $1', [req.params.id]);
  await audit(req.user!.id, 'delete', 'event', req.params.id);
  hub.toAll({ t: 'events:changed', eventId: req.params.id });
  res.json({ ok: true });
}));

// ===== Confirmación del componente (no es el registro oficial) =====
eventsRouter.put('/:id/rsvp', h(async (req, res) => {
  const b = parse(z.object({ response: z.enum(['asistire', 'no_asistire']), reason: z.string().max(500).nullable().optional() }), req.body);
  const e = await one<any>('select section_ids, starts_at, status from events where id = $1', [req.params.id]);
  if (!e || !convoked(req.user!, e)) throw new HttpError(404, 'Evento no encontrado.');
  if (e.status !== 'programado') throw new HttpError(400, 'El evento ya no admite confirmaciones.');
  if (b.response === 'no_asistire' && !b.reason?.trim()) throw new HttpError(400, 'Indica el motivo de la ausencia.');
  await q(`insert into event_rsvp(event_id, user_id, response, reason) values ($1,$2,$3,$4)
    on conflict (event_id, user_id) do update set response = excluded.response, reason = excluded.reason, updated_at = now()`, [req.params.id, req.user!.id, b.response, b.reason ?? null]);
  hub.toStaff({ t: 'rsvp', eventId: req.params.id, userId: req.user!.id, response: b.response });
  res.json({ ok: true });
}));

// ===== Registro oficial de asistencia: solo dirección o responsables con permiso =====
async function assertCanRecord(user: AuthUser, eventId: string, userIds: string[]) {
  const secs = sectionsWith(user, 'attendance', 'events.manage');
  if (secs === 'all') return;
  if (!secs.length) throw new HttpError(403, 'No puedes registrar asistencia.');
  const roster = await convokedMembers(eventId);
  for (const id of userIds) {
    const m = roster.find((r) => r.id === id);
    if (!m || !secs.includes(m.section_id)) throw new HttpError(403, 'Solo puedes registrar la asistencia de tu sección.');
  }
}

async function recordAttendance(eventId: string, userId: string, status: string, minutesLate: number | null, note: string | null, by: string, method: 'manual' | 'qr') {
  const old = await one<any>('select status from attendance where event_id = $1 and user_id = $2', [eventId, userId]);
  await q(`insert into attendance(event_id, user_id, status, minutes_late, note, method, recorded_by) values ($1,$2,$3,$4,$5,$6,$7)
    on conflict (event_id, user_id) do update set status = excluded.status, minutes_late = excluded.minutes_late, note = excluded.note, method = excluded.method, recorded_by = excluded.recorded_by, recorded_at = now()`,
    [eventId, userId, status, minutesLate, note, method, by]);
  if (old?.status !== status) await q('insert into attendance_log(event_id, user_id, old_status, new_status, changed_by, method) values ($1,$2,$3,$4,$5,$6)', [eventId, userId, old?.status ?? null, status, by, method]);
}

eventsRouter.put('/:id/attendance', h(async (req, res) => {
  const list = parse(z.array(z.object({ user_id: z.string().uuid(), status: z.enum(ATT_STATUS), minutes_late: z.number().int().min(0).max(600).nullable().optional(), note: z.string().max(300).nullable().optional() })).min(1).max(300), req.body);
  await assertCanRecord(req.user!, req.params.id, list.map((l) => l.user_id));
  for (const l of list) await recordAttendance(req.params.id, l.user_id, l.status, l.status === 'retraso' ? l.minutes_late ?? null : null, l.note ?? null, req.user!.id, 'manual');
  for (const l of list) hub.toUser(l.user_id, { t: 'attendance', eventId: req.params.id, status: l.status });
  hub.toStaff({ t: 'attendance:changed', eventId: req.params.id });
  res.json({ ok: true });
}));

eventsRouter.get('/:id/attendance/log', h(async (req, res) => {
  const secs = sectionsWith(req.user!, 'attendance', 'events.manage');
  if (secs !== 'all' && !secs.length) throw new HttpError(403, 'Sin permiso.');
  res.json(await q(`select l.*, u.name as user_name, c.name as changed_by_name from attendance_log l join users u on u.id = l.user_id left join users c on c.id = l.changed_by where l.event_id = $1 order by l.at desc`, [req.params.id]));
}));

// ===== Registro por QR =====
// El código cambia cada 20 s (HMAC del secreto del evento); vale para la ventana actual y la anterior.
const WINDOW_MS = 20_000;
function qrCode(secret: string, w: number) {
  return crypto.createHmac('sha256', secret).update(String(w)).digest('base64url').slice(0, 10);
}
eventsRouter.post('/:id/checkin/open', h(async (req, res) => {
  await assertCanRecord(req.user!, req.params.id, []);
  const { open } = parse(z.object({ open: z.boolean() }), req.body);
  await q(`update events set checkin_open = $2, checkin_secret = coalesce(checkin_secret, $3) where id = $1`, [req.params.id, open, randomToken(24)]);
  res.json({ ok: true });
}));
eventsRouter.get('/:id/checkin/code', h(async (req, res) => {
  await assertCanRecord(req.user!, req.params.id, []);
  const e = await one<any>('select checkin_secret, checkin_open from events where id = $1', [req.params.id]);
  if (!e?.checkin_open || !e.checkin_secret) throw new HttpError(400, 'El registro por QR no está abierto.');
  const w = Math.floor(Date.now() / WINDOW_MS);
  res.json({ code: qrCode(e.checkin_secret, w), expiresIn: WINDOW_MS - (Date.now() % WINDOW_MS) });
}));
eventsRouter.post('/:id/checkin', h(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().min(6).max(20) }), req.body);
  const e = await one<any>('select * from events where id = $1', [req.params.id]);
  if (!e || !convoked(req.user!, e)) throw new HttpError(404, 'Evento no encontrado.');
  if (!e.checkin_open) throw new HttpError(400, 'El registro por QR está cerrado.');
  const now = Date.now();
  const start = new Date(e.call_at ?? e.starts_at).getTime() - 90 * 60_000;
  const end = new Date(e.ends_at ?? new Date(new Date(e.starts_at).getTime() + 4 * 3600_000)).getTime();
  if (now < start || now > end) throw new HttpError(400, 'El registro solo está disponible durante el evento.');
  const w = Math.floor(now / WINDOW_MS);
  if (code !== qrCode(e.checkin_secret, w) && code !== qrCode(e.checkin_secret, w - 1)) throw new HttpError(400, 'Código caducado o no válido. Escanea el QR que se muestra ahora mismo en el ensayo.');
  const existing = await one<any>('select status from attendance where event_id = $1 and user_id = $2', [e.id, req.user!.id]);
  if (existing && ['presente', 'retraso'].includes(existing.status)) return res.json({ ok: true, duplicate: true, status: existing.status });
  const ref = new Date(e.call_at ?? e.starts_at).getTime();
  const late = Math.floor((now - ref) / 60_000);
  const status = late > 5 ? 'retraso' : 'presente';
  await recordAttendance(e.id, req.user!.id, status, status === 'retraso' ? late : null, null, req.user!.id, 'qr');
  hub.toStaff({ t: 'attendance:changed', eventId: e.id });
  res.json({ ok: true, status, minutes_late: status === 'retraso' ? late : null });
}));

// ===== Plan de trabajo del ensayo =====
eventsRouter.put('/:id/plan', manage, h(async (req, res) => {
  const items = parse(z.array(z.object({ id: z.string().uuid().optional(), title: z.string().min(1).max(160), marcha_id: z.string().uuid().nullable().optional(),
    measure_from: z.number().int().min(1).nullable().optional(), measure_to: z.number().int().min(1).nullable().optional(), notes: z.string().max(1000).nullable().optional(), done: z.boolean().optional() })).max(60), req.body);
  await tx(async (c) => {
    await q('delete from rehearsal_plan where event_id = $1', [req.params.id], c);
    for (const [i, it] of items.entries()) {
      await q('insert into rehearsal_plan(id, event_id, sort, title, marcha_id, measure_from, measure_to, notes, done) values (coalesce($1, gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9)',
        [it.id ?? null, req.params.id, i, it.title, it.marcha_id ?? null, it.measure_from ?? null, it.measure_to ?? null, it.notes ?? null, it.done ?? false], c);
    }
  });
  hub.publish(`event:${req.params.id}`, { t: 'plan:changed', eventId: req.params.id });
  res.json({ ok: true });
}));
eventsRouter.patch('/:id/plan/:itemId', h(async (req, res) => {
  if (!can(req.user, 'events.manage') && !can(req.user, 'live.direct')) throw new HttpError(403, 'Sin permiso.');
  const { done } = parse(z.object({ done: z.boolean() }), req.body);
  await q('update rehearsal_plan set done = $3 where id = $2 and event_id = $1', [req.params.id, req.params.itemId, done]);
  hub.publish(`event:${req.params.id}`, { t: 'plan:changed', eventId: req.params.id });
  res.json({ ok: true });
}));

eventsRouter.post('/:id/passages', h(async (req, res) => {
  if (!can(req.user, 'events.manage') && !can(req.user, 'live.direct')) throw new HttpError(403, 'Sin permiso.');
  const b = parse(z.object({ marcha_id: z.string().uuid(), measure_from: z.number().int().min(1).nullable().optional(), measure_to: z.number().int().min(1).nullable().optional(), note: z.string().max(500).nullable().optional() }), req.body);
  res.json(await one('insert into passage_work(event_id, marcha_id, measure_from, measure_to, note, created_by) values ($1,$2,$3,$4,$5,$6) returning *',
    [req.params.id, b.marcha_id, b.measure_from ?? null, b.measure_to ?? null, b.note ?? null, req.user!.id]));
}));
eventsRouter.delete('/:id/passages/:pid', manage, h(async (req, res) => {
  await q('delete from passage_work where id = $1 and event_id = $2', [req.params.pid, req.params.id]);
  res.json({ ok: true });
}));

/** Resumen final del ensayo: contenidos trabajados, incidencias y tareas para el próximo. */
eventsRouter.put('/:id/summary', h(async (req, res) => {
  if (!can(req.user, 'events.manage') && !can(req.user, 'live.direct')) throw new HttpError(403, 'Sin permiso.');
  const b = parse(z.object({ worked: z.string().max(5000), incidents: z.string().max(5000), tasks: z.string().max(5000), finish: z.boolean().default(false) }), req.body);
  await q(`update events set summary = $2, status = case when $3 then 'finalizado' else status end where id = $1`, [req.params.id, JSON.stringify({ ...b, saved_by: req.user!.name, saved_at: new Date().toISOString() }), b.finish]);
  hub.toAll({ t: 'events:changed', eventId: req.params.id });
  res.json({ ok: true });
}));

/** Parte que abrirá cada componente en este evento (si tiene varias asignaciones). */
eventsRouter.put('/:id/overrides', h(async (req, res) => {
  if (!can(req.user, 'assignments.manage') && !can(req.user, 'live.direct')) throw new HttpError(403, 'Sin permiso.');
  const b = parse(z.object({ user_id: z.string().uuid(), assignment_id: z.number().int().nullable() }), req.body);
  if (b.assignment_id == null) await q('delete from event_assignment_overrides where event_id = $1 and user_id = $2', [req.params.id, b.user_id]);
  else {
    const ok = await one('select 1 from user_assignments where id = $1 and user_id = $2', [b.assignment_id, b.user_id]);
    if (!ok) throw new HttpError(400, 'Esa asignación no pertenece al componente.');
    await q(`insert into event_assignment_overrides values ($1,$2,$3) on conflict (event_id, user_id) do update set assignment_id = excluded.assignment_id`, [req.params.id, b.user_id, b.assignment_id]);
  }
  hub.toUser(b.user_id, { t: 'live:part-changed' });
  res.json({ ok: true });
}));

/** Comparación entre ensayos: pasajes trabajados repetidamente. */
eventsRouter.get('/passages/repeated', h(async (req, res) => {
  res.json(await q(`select m.id as marcha_id, m.title, pw.measure_from, pw.measure_to, count(distinct pw.event_id)::int as times,
      json_agg(json_build_object('event', e.title, 'date', e.starts_at, 'note', pw.note) order by e.starts_at) as sessions
    from passage_work pw join marchas m on m.id = pw.marcha_id join events e on e.id = pw.event_id
    group by m.id, m.title, pw.measure_from, pw.measure_to having count(distinct pw.event_id) > 1 order by times desc, m.title limit 50`));
}));

eventsRouter.get('/:id/export.csv', h(async (req, res) => {
  const secs = sectionsWith(req.user!, 'attendance', 'events.manage');
  if (secs !== 'all') throw new HttpError(403, 'Sin permiso.');
  const e = await one<any>('select title, starts_at from events where id = $1', [req.params.id]);
  const roster = await convokedMembers(req.params.id);
  const att = await q<any>('select * from attendance where event_id = $1', [req.params.id]);
  const rsvp = await q<any>('select * from event_rsvp where event_id = $1', [req.params.id]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="asistencia-${new Date(e.starts_at).toISOString().slice(0, 10)}.csv"`);
  res.send(toCsv([['componente', 'sección', 'asignación', 'confirmación', 'motivo', 'asistencia', 'minutos tarde', 'método'],
    ...roster.map((m) => { const a = att.find((x) => x.user_id === m.id); const r = rsvp.find((x) => x.user_id === m.id);
      return [m.name, m.section, m.assignment, r?.response ?? 'sin confirmar', r?.reason, a?.status ?? 'pendiente', a?.minutes_late, a?.method]; })]));
}));
