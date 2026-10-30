import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.ts';
import { h, parse, HttpError } from '../lib/http.ts';
import { requireAuth, can, type AuthUser } from '../lib/auth.ts';
import { upload, storeFile } from '../lib/files.ts';

export const academyRouter = Router();
academyRouter.use(requireAuth);

/** Puede crear/editar contenidos: dirección, permiso de academia o responsables con «lessons». */
function editor(u: AuthUser) {
  return can(u, 'academy.manage') || u.leaderOf.some((l) => l.permissions.includes('lessons'));
}
/** Solo la dirección (o permiso de academia) publica: los responsables revisan. */
const publisher = (u: AuthUser) => can(u, 'academy.manage');

academyRouter.get('/courses', h(async (req, res) => {
  const ed = editor(req.user!);
  const rows = await q<any>(`select c.*, s.name as section_name,
      (select count(*) from lessons l where l.course_id = c.id and ($2 or l.status = 'publicado'))::int as lessons,
      (select count(*) from lessons l join lesson_progress p on p.lesson_id = l.id and p.user_id = $1 where l.course_id = c.id and p.completed_at is not null and l.status = 'publicado')::int as completed
    from courses c left join sections s on s.id = c.section_id where ($2 or c.status = 'publicado') order by c.level, c.sort, c.title`, [req.user!.id, ed]);
  res.json(rows);
}));

academyRouter.get('/courses/:id', h(async (req, res) => {
  const ed = editor(req.user!);
  const c = await one<any>('select * from courses where id = $1', [req.params.id]);
  if (!c || (!ed && c.status !== 'publicado')) throw new HttpError(404, 'Curso no encontrado.');
  const lessons = await q(`select l.id, l.sort, l.title, l.status, p.completed_at, p.quiz_score from lessons l
    left join lesson_progress p on p.lesson_id = l.id and p.user_id = $2 where l.course_id = $1 and ($3 or l.status = 'publicado') order by l.sort`, [c.id, req.user!.id, ed]);
  res.json({ ...c, lessons, can_edit: ed, can_publish: publisher(req.user!) });
}));

academyRouter.get('/lessons/:id', h(async (req, res) => {
  const ed = editor(req.user!);
  const l = await one<any>(`select l.*, c.title as course_title, c.level, c.status as course_status, ru.name as reviewed_by_name from lessons l join courses c on c.id = l.course_id
    left join users ru on ru.id = l.reviewed_by where l.id = $1`, [req.params.id]);
  if (!l || (!ed && (l.status !== 'publicado' || l.course_status !== 'publicado'))) throw new HttpError(404, 'Lección no encontrada.');
  const progress = await one('select * from lesson_progress where user_id = $1 and lesson_id = $2', [req.user!.id, l.id]);
  const siblings = await q<any>(`select id, title, sort from lessons where course_id = $1 and ($2 or status = 'publicado') order by sort`, [l.course_id, ed]);
  const idx = siblings.findIndex((s) => s.id === l.id);
  // las respuestas correctas del test se envían: el test es formativo, no evaluación oficial
  res.json({ ...l, progress, prev: siblings[idx - 1] ?? null, next: siblings[idx + 1] ?? null, can_edit: ed, can_publish: publisher(req.user!) });
}));

const courseBody = z.object({ level: z.number().int().min(1).max(3), title: z.string().min(2).max(160), description: z.string().max(2000).nullable().optional(),
  section_id: z.number().int().nullable().optional(), sort: z.number().int().default(0) });
academyRouter.post('/courses', h(async (req, res) => {
  if (!editor(req.user!)) throw new HttpError(403, 'Sin permiso.');
  const b = parse(courseBody, req.body);
  res.json(await one(`insert into courses(level, title, description, section_id, sort, created_by) values ($1,$2,$3,$4,$5,$6) returning *`, [b.level, b.title, b.description ?? null, b.section_id ?? null, b.sort, req.user!.id]));
}));
academyRouter.put('/courses/:id', h(async (req, res) => {
  if (!editor(req.user!)) throw new HttpError(403, 'Sin permiso.');
  const b = parse(courseBody.extend({ status: z.enum(['borrador', 'revision', 'publicado']).optional() }), req.body);
  if (b.status === 'publicado' && !publisher(req.user!)) throw new HttpError(403, 'Solo la dirección publica cursos.');
  await q(`update courses set level=$2, title=$3, description=$4, section_id=$5, sort=$6, status=coalesce($7,status), reviewed_by = case when $7 = 'publicado' then $8 else reviewed_by end where id=$1`,
    [req.params.id, b.level, b.title, b.description ?? null, b.section_id ?? null, b.sort, b.status ?? null, req.user!.id]);
  res.json({ ok: true });
}));

const quizItem = z.object({ q: z.string().min(1).max(500), options: z.array(z.string().max(200)).min(2).max(6), answer: z.number().int().min(0), explain: z.string().max(500).optional() });
const lessonBody = z.object({
  course_id: z.string().uuid(), sort: z.number().int().default(0), title: z.string().min(2).max(160),
  explanation: z.string().min(1).max(20000), demo: z.any().nullable().optional(), audio: z.any().nullable().optional(), exercise: z.any().nullable().optional(),
  quiz: z.array(quizItem).max(30).default([]), practice: z.string().max(5000).nullable().optional(), summary: z.string().max(5000).nullable().optional(),
  status: z.enum(['borrador', 'revision', 'publicado']).default('borrador'),
});
academyRouter.post('/lessons', h(async (req, res) => {
  if (!editor(req.user!)) throw new HttpError(403, 'Sin permiso.');
  const b = parse(lessonBody, req.body);
  if (b.status === 'publicado' && !publisher(req.user!)) b.status = 'revision';
  res.json(await one(`insert into lessons(course_id, sort, title, explanation, demo, audio, exercise, quiz, practice, summary, status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [b.course_id, b.sort, b.title, b.explanation, b.demo ? JSON.stringify(b.demo) : null, b.audio ? JSON.stringify(b.audio) : null, b.exercise ? JSON.stringify(b.exercise) : null, JSON.stringify(b.quiz), b.practice ?? null, b.summary ?? null, b.status]));
}));
academyRouter.put('/lessons/:id', h(async (req, res) => {
  if (!editor(req.user!)) throw new HttpError(403, 'Sin permiso.');
  const b = parse(lessonBody, req.body);
  if (b.status === 'publicado' && !publisher(req.user!)) throw new HttpError(403, 'La publicación la realiza la dirección tras la revisión.');
  await q(`update lessons set course_id=$2, sort=$3, title=$4, explanation=$5, demo=$6, audio=$7, exercise=$8, quiz=$9, practice=$10, summary=$11, status=$12,
      reviewed_by = case when $12 = 'publicado' then $13 else reviewed_by end, updated_at = now() where id = $1`,
    [req.params.id, b.course_id, b.sort, b.title, b.explanation, b.demo ? JSON.stringify(b.demo) : null, b.audio ? JSON.stringify(b.audio) : null, b.exercise ? JSON.stringify(b.exercise) : null, JSON.stringify(b.quiz), b.practice ?? null, b.summary ?? null, b.status, req.user!.id]);
  res.json({ ok: true });
}));
academyRouter.delete('/lessons/:id', h(async (req, res) => {
  if (!publisher(req.user!)) throw new HttpError(403, 'Sin permiso.');
  await q('delete from lessons where id = $1', [req.params.id]);
  res.json({ ok: true });
}));

/** Material didáctico de la dirección → borrador de lección pendiente de revisión (nunca se publica solo). */
academyRouter.post('/materials', upload.single('file'), h(async (req, res) => {
  if (!editor(req.user!)) throw new HttpError(403, 'Sin permiso.');
  const b = parse(z.object({ course_id: z.string().uuid(), title: z.string().min(2).max(160), text: z.string().max(20000).default('') }), req.body);
  const l = await tx(async (c) => {
    const f = req.file ? await storeFile(req.file.buffer, req.file.originalname, req.user!.id, ['pdf', 'image', 'audio', 'document'], c) : null;
    return one<any>(`insert into lessons(course_id, sort, title, explanation, quiz, status, source_material_id) values ($1, 999, $2, $3, '[]', 'borrador', $4) returning id`,
      [b.course_id, b.title, b.text || 'Material pendiente de convertir en explicación. Completa los apartados antes de enviarlo a revisión.', f?.id ?? null], c);
  });
  res.json({ id: l.id, note: 'Borrador creado. Puedes usar el asistente para proponer ejercicios y test; revísalos antes de publicar.' });
}));

academyRouter.post('/lessons/:id/progress', h(async (req, res) => {
  const b = parse(z.object({ completed: z.boolean().default(false), quiz_score: z.number().int().min(0).max(100).nullable().optional(), minutes: z.number().int().min(0).max(240).default(0) }), req.body);
  await q(`insert into lesson_progress(user_id, lesson_id, completed_at, quiz_score, attempts) values ($1,$2, case when $3 then now() end, $4, 1)
    on conflict (user_id, lesson_id) do update set completed_at = coalesce(lesson_progress.completed_at, excluded.completed_at),
      quiz_score = greatest(coalesce(lesson_progress.quiz_score, 0), coalesce(excluded.quiz_score, 0)), attempts = lesson_progress.attempts + 1`,
    [req.user!.id, req.params.id, b.completed, b.quiz_score ?? null]);
  await q(`insert into study_days(user_id, day, minutes) values ($1, current_date, $2) on conflict (user_id, day) do update set minutes = study_days.minutes + excluded.minutes`, [req.user!.id, b.minutes]);
  res.json({ ok: true });
}));

academyRouter.post('/exercise-results', h(async (req, res) => {
  const list = parse(z.array(z.object({ exercise: z.enum(['lectura', 'oido', 'ritmo', 'intervalos']), item: z.string().min(1).max(40), correct: z.boolean(), ms: z.number().int().min(0).max(600000).optional() })).min(1).max(200), req.body);
  await tx(async (c) => {
    for (const r of list) await q('insert into exercise_results(user_id, exercise, item, correct, ms) values ($1,$2,$3,$4,$5)', [req.user!.id, r.exercise, r.item, r.correct, r.ms ?? null], c);
    await q(`insert into study_days(user_id, day, minutes) values ($1, current_date, 1) on conflict (user_id, day) do update set minutes = study_days.minutes + 1`, [req.user!.id], c);
  });
  res.json({ ok: true });
}));

export async function myStats(userId: string) {
  const days = await q<any>(`select day from study_days where user_id = $1 and day > current_date - 400 order by day desc`, [userId]);
  // racha: días consecutivos hasta hoy (o ayer)
  let streak = 0;
  const set = new Set(days.map((d) => d.day));
  const d = new Date();
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  if (!set.has(iso(d))) d.setDate(d.getDate() - 1);
  while (set.has(iso(d))) { streak++; d.setDate(d.getDate() - 1); }
  const weak = await q<any>(`select exercise, item, count(*)::int as total, count(*) filter (where not correct)::int as fails,
      round(avg(ms) filter (where correct))::int as avg_ms
    from (select * from exercise_results where user_id = $1 order by at desc limit 2000) r group by exercise, item
    having count(*) >= 2 order by (count(*) filter (where not correct))::float / count(*) desc, count(*) desc limit 12`, [userId]);
  const totals = await one<any>(`select count(*)::int as answers, count(*) filter (where correct)::int as correct from exercise_results where user_id = $1`, [userId]);
  const lessons = await one<any>(`select count(*) filter (where completed_at is not null)::int as completed from lesson_progress where user_id = $1`, [userId]);
  const recent = await q<any>(`select date_trunc('week', at)::date as week, count(*)::int as total, count(*) filter (where correct)::int as correct
    from exercise_results where user_id = $1 and at > now() - interval '12 weeks' group by 1 order by 1`, [userId]);
  return { streak, studyDays: days.length, weak, totals, lessons, recent };
}

academyRouter.get('/me/stats', h(async (req, res) => res.json(await myStats(req.user!.id))));
