import { Router } from 'express';
import { z } from 'zod';
import { q, one } from '../db.ts';
import { h, parse, HttpError } from '../lib/http.ts';
import { requireAuth, can, sectionsWith } from '../lib/auth.ts';
import { toCsv } from '../lib/csv.ts';

export const statsRouter = Router();
statsRouter.use(requireAuth);

/**
 * Panel de dirección. Cada bloque indica su naturaleza:
 *  - objetivo: recuento directo de registros
 *  - estimacion: cálculo derivado con supuestos (se explica)
 *  - manual: valoración introducida por personas
 * No se emite ningún juicio sobre cómo toca un músico.
 */
statsRouter.get('/', h(async (req, res) => {
  const secs = can(req.user, 'stats.view') ? 'all' : sectionsWith(req.user!, 'attendance');
  if (secs !== 'all' && !secs.length) throw new HttpError(403, 'Sin permiso.');
  const f = parse(z.object({ from: z.string().optional(), to: z.string().optional() }), req.query);
  // temporada por defecto: desde el 1 de septiembre
  const now = new Date();
  const seasonStart = new Date(now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1, 8, 1);
  const from = f.from ? new Date(f.from) : seasonStart;
  const to = f.to ? new Date(f.to) : new Date(now.getTime() + 86400000);
  const secFilter = secs === 'all' ? null : secs;

  const byMonth = await q(`select to_char(date_trunc('month', e.starts_at), 'YYYY-MM') as month,
      count(*) filter (where a.status = 'presente')::int as presente, count(*) filter (where a.status = 'retraso')::int as retraso,
      count(*) filter (where a.status = 'ausente')::int as ausente, count(*) filter (where a.status = 'justificada')::int as justificada,
      count(distinct e.id)::int as eventos
    from events e join attendance a on a.event_id = e.id
    left join lateral (select min(i.section_id) as section_id from user_assignments ua join instruments i on i.id = ua.instrument_id where ua.user_id = a.user_id) us on true
    where e.starts_at between $1 and $2 and ($3::int[] is null or us.section_id = any($3)) group by 1 order by 1`, [from, to, secFilter]);

  const bySection = await q(`select s.id, s.name, s.color,
      count(*) filter (where a.status in ('presente','retraso'))::int as asistencias, count(a.*)::int as registros,
      count(*) filter (where a.status = 'retraso')::int as retrasos
    from sections s
    left join instruments i on i.section_id = s.id left join user_assignments ua on ua.instrument_id = i.id and ua.is_default
    left join attendance a on a.user_id = ua.user_id and a.event_id in (select id from events where starts_at between $1 and $2)
    where ($3::int[] is null or s.id = any($3)) group by s.id order by s.sort`, [from, to, secFilter]);

  const byPerson = await q(`select u.id, u.name, s.name as section,
      count(a.*)::int as registros, count(*) filter (where a.status = 'presente')::int as presente, count(*) filter (where a.status = 'retraso')::int as retraso,
      count(*) filter (where a.status = 'ausente')::int as ausente, count(*) filter (where a.status = 'justificada')::int as justificada,
      coalesce(sum(a.minutes_late), 0)::int as minutos_tarde
    from users u left join user_assignments ua on ua.user_id = u.id and ua.is_default left join instruments i on i.id = ua.instrument_id left join sections s on s.id = i.section_id
    left join attendance a on a.user_id = u.id and a.event_id in (select id from events where starts_at between $1 and $2)
    where u.status = 'active' and ($3::int[] is null or i.section_id = any($3)) group by u.id, s.name, s.sort order by s.sort nulls last, u.name`, [from, to, secFilter]);

  const pending = await q(`select e.id, e.title, e.starts_at, (select count(*) from event_rsvp r where r.event_id = e.id)::int as confirmed,
      (select count(*) from event_rsvp r where r.event_id = e.id and r.response = 'no_asistire')::int as declined,
      (select count(*) from users u where u.status = 'active' and (cardinality(e.section_ids) = 0 or exists (select 1 from user_assignments ua join instruments i on i.id = ua.instrument_id where ua.user_id = u.id and i.section_id = any(e.section_ids))))::int as convoked
    from events e where e.starts_at > now() and e.status = 'programado' order by e.starts_at limit 10`);

  const courses = await q(`select c.title, c.level, count(distinct p.user_id) filter (where p.completed_at is not null)::int as people_with_progress,
      (select count(*) from lessons l where l.course_id = c.id and l.status = 'publicado')::int as lessons,
      count(p.*) filter (where p.completed_at is not null)::int as lessons_completed
    from courses c left join lessons l on l.course_id = c.id left join lesson_progress p on p.lesson_id = l.id where c.status = 'publicado' group by c.id order by c.level, c.sort`);

  const exercises = await q(`select to_char(date_trunc('week', at), 'YYYY-MM-DD') as week, exercise, count(*)::int as total, count(*) filter (where correct)::int as correct, count(distinct user_id)::int as people
    from exercise_results where at between $1 and $2 group by 1, 2 order by 1`, [from, to]);

  const marchas = await q(`select m.title, count(*)::int as opens, count(distinct u.user_id)::int as people
    from material_usage u join marchas m on m.id::text = u.ref_id where u.kind = 'marcha' and u.at between $1 and $2 group by m.title order by opens desc limit 15`, [from, to]);

  const usage = await q(`select kind, count(*)::int as total, count(distinct user_id)::int as people from material_usage where at between $1 and $2 group by kind order by total desc`, [from, to]);

  const passages = await q(`select m.title, pw.measure_from, pw.measure_to, count(distinct pw.event_id)::int as times from passage_work pw join marchas m on m.id = pw.marcha_id
    group by m.title, pw.measure_from, pw.measure_to having count(distinct pw.event_id) > 1 order by times desc limit 10`);

  const doubts = await q(`select m.title, d.measure, d.page, count(*)::int as total from doubts d join marchas m on m.id = d.marcha_id
    where d.created_at between $1 and $2 group by m.title, d.measure, d.page having count(*) > 1 order by total desc limit 10`, [from, to]);

  const sync = await q(`select kind, count(*)::int as total, count(distinct device_id)::int as devices,
      round(avg((detail->>'lateMs')::numeric))::int as avg_late_ms
    from live_device_log where at between $1 and $2 group by kind order by kind`, [from, to]);

  res.json({
    period: { from, to },
    blocks: {
      attendanceByMonth: { nature: 'objetivo', note: 'Recuento de registros oficiales de asistencia.', rows: byMonth },
      attendanceBySection: { nature: 'objetivo', note: 'Según la asignación principal de cada componente.', rows: bySection },
      attendanceByPerson: { nature: 'objetivo', note: 'La asistencia no mide la calidad musical de nadie.', rows: byPerson },
      pendingConfirmations: { nature: 'objetivo', note: 'Convocados estimados por sección; incluye quien aún no ha respondido.', rows: pending },
      courses: { nature: 'objetivo', note: 'Lecciones marcadas como completadas por cada componente.', rows: courses },
      exercises: { nature: 'estimacion', note: 'Aciertos en ejercicios de la app. Indican práctica, no nivel interpretativo.', rows: exercises },
      marchasStudied: { nature: 'estimacion', note: 'Aperturas de la ficha/partitura en la app; abrir no equivale a estudiar.', rows: marchas },
      materialUsage: { nature: 'objetivo', note: 'Accesos a materiales registrados por la app.', rows: usage },
      repeatedPassages: { nature: 'manual', note: 'Pasajes que la dirección anotó como trabajados en varios ensayos.', rows: passages },
      repeatedDoubts: { nature: 'objetivo', note: 'Zonas con varias dudas: posibles puntos a explicar a toda la sección.', rows: doubts },
      syncIncidents: { nature: 'objetivo', note: 'Conexiones, desconexiones y órdenes recibidas tarde durante sesiones en directo.', rows: sync },
    },
  });
}));

statsRouter.get('/report.csv', h(async (req, res) => {
  if (!can(req.user, 'stats.view')) throw new HttpError(403, 'Sin permiso.');
  const rows = await q<any>(`select u.name, s.name as section, count(a.*)::int as registros, count(*) filter (where a.status='presente')::int as presente,
      count(*) filter (where a.status='retraso')::int as retraso, count(*) filter (where a.status='ausente')::int as ausente, count(*) filter (where a.status='justificada')::int as justificada,
      (select count(*) from lesson_progress p where p.user_id = u.id and p.completed_at is not null)::int as lecciones
    from users u left join user_assignments ua on ua.user_id = u.id and ua.is_default left join instruments i on i.id = ua.instrument_id left join sections s on s.id = i.section_id
    left join attendance a on a.user_id = u.id where u.status = 'active' group by u.id, s.name order by s.name, u.name`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="informe-direccion.csv"');
  res.send(toCsv([['componente', 'sección', 'registros', 'presente', 'retraso', 'ausente', 'justificada', 'lecciones completadas'],
    ...rows.map((r) => [r.name, r.section, r.registros, r.presente, r.retraso, r.ausente, r.justificada, r.lecciones])]));
}));

statsRouter.get('/me', h(async (req, res) => {
  res.json({
    attendance: await one(`select count(*)::int as total, count(*) filter (where status='presente')::int as presente, count(*) filter (where status='retraso')::int as retraso,
      count(*) filter (where status='ausente')::int as ausente, count(*) filter (where status='justificada')::int as justificada from attendance where user_id = $1`, [req.user!.id]),
    history: await q(`select e.id, e.title, e.type, e.starts_at, a.status, a.minutes_late, a.method from attendance a join events e on e.id = a.event_id where a.user_id = $1 order by e.starts_at desc limit 50`, [req.user!.id]),
  });
}));
