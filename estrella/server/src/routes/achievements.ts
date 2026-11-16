import { Router } from 'express';
import { one, q } from '../db.ts';
import { h, HttpError } from '../lib/http.ts';
import { requireAuth, can } from '../lib/auth.ts';

/**
 * Logros: se calculan al momento con lo que la app ya registra (asistencia oficial, confirmaciones,
 * marchas estudiadas, academia, dudas, avisos…). No hay nada que «rellenar» a mano ni tabla aparte.
 * Cada logro tiene niveles (bronce, plata, oro); los de un solo paso son de oro directamente.
 * Solo premia constancia y participación: nunca valora cómo toca nadie.
 */
export const achievementsRouter = Router();
achievementsRouter.use(requireAuth);

interface Def { id: string; title: string; icon: string; unit: string; levels: number[]; desc: (n: number) => string }
const DEFS: Def[] = [
  { id: 'asistencia', title: 'Siempre presente', icon: 'CalendarCheck', unit: 'ensayo o actuación|ensayos y actuaciones', levels: [10, 25, 50], desc: (n) => `Asiste a ${n} ensayos o actuaciones` },
  { id: 'racha', title: 'Racha imparable', icon: 'Flame', unit: 'seguida sin faltar|seguidas sin faltar', levels: [3, 8, 15], desc: (n) => `Ve a ${n} citas seguidas sin faltar` },
  { id: 'puntual', title: 'Puntual como un reloj', icon: 'AlarmClock', unit: 'vez seguida a la hora|veces seguidas a la hora', levels: [5, 15, 30], desc: (n) => `Llega a la hora ${n} veces seguidas` },
  { id: 'procesion', title: 'Detrás del trono', icon: 'Church', unit: 'procesión|procesiones', levels: [1, 5, 15], desc: (n) => `Sal en ${n} procesión${n > 1 ? 'es' : ''}` },
  { id: 'escenario', title: 'Sobre el escenario', icon: 'Sparkles', unit: 'concierto o actuación|conciertos y actuaciones', levels: [1, 5, 15], desc: (n) => `Toca en ${n} concierto${n > 1 ? 's' : ''} o actuacion${n > 1 ? 'es' : ''}` },
  { id: 'confirma', title: 'Palabra de músico', icon: 'CheckCheck', unit: 'cita confirmada|citas confirmadas', levels: [5, 20, 50], desc: (n) => `Responde «Voy / No voy» a ${n} citas` },
  { id: 'repertorio', title: 'Repertorio en la cabeza', icon: 'Music', unit: 'marcha estudiada|marchas estudiadas', levels: [3, 10, 25], desc: (n) => `Estudia ${n} marchas distintas en la app` },
  { id: 'estudio', title: 'Constancia', icon: 'BookOpen', unit: 'día seguido estudiando|días seguidos estudiando', levels: [3, 7, 30], desc: (n) => `Estudia ${n} días seguidos en la Academia` },
  { id: 'oido', title: 'Oído fino', icon: 'Ear', unit: 'ejercicio acertado|ejercicios acertados', levels: [25, 100, 500], desc: (n) => `Acierta ${n} ejercicios de lectura, oído o ritmo` },
  { id: 'academia', title: 'Alumno aplicado', icon: 'GraduationCap', unit: 'lección|lecciones', levels: [1, 5, 15], desc: (n) => `Completa ${n} ${n > 1 ? 'lecciones' : 'lección'} de la Academia` },
  { id: 'dudas', title: 'Sin quedarse con la duda', icon: 'MessageCircleQuestion', unit: 'duda preguntada|dudas preguntadas', levels: [1, 5, 15], desc: (n) => `Pregunta ${n} duda${n > 1 ? 's' : ''} sobre una partitura` },
  { id: 'avisos', title: 'Bien informado', icon: 'Megaphone', unit: 'aviso leído|avisos leídos', levels: [5, 25, 75], desc: (n) => `Lee ${n} avisos` },
  { id: 'veterano', title: 'De la casa', icon: 'Medal', unit: 'día en la banda|días en la banda', levels: [30, 365, 1095], desc: (n) => (n >= 365 ? `Cumple ${Math.round(n / 365)} año${n >= 730 ? 's' : ''} en la banda` : `Cumple ${n} días en la banda`) },
  { id: 'faceid', title: 'Entrada VIP', icon: 'ScanFace', unit: '', levels: [1], desc: () => 'Activa la entrada con Face ID o huella' },
  { id: 'arreglista', title: 'Mi propia marcha', icon: 'PenLine', unit: '', levels: [1], desc: () => 'Sube una marcha tuya para estudiarla' },
];
export const LEVEL_NAMES = ['Bronce', 'Plata', 'Oro'];

/** Racha más larga de elementos seguidos que cumplen `ok`, sin cortar en los que `skip` (p. ej. falta justificada). */
function bestRun<T>(xs: T[], ok: (x: T) => boolean, skip: (x: T) => boolean = () => false) {
  let best = 0, cur = 0;
  for (const x of xs) { if (skip(x)) continue; if (ok(x)) best = Math.max(best, ++cur); else cur = 0; }
  return best;
}

export async function achievementsFor(userId: string) {
  const u = await one<any>('select id, name, joined_at, created_at from users where id = $1', [userId]);
  if (!u) throw new HttpError(404, 'No existe ese componente.');
  const att = await q<any>(`select a.status, e.type from attendance a join events e on e.id = a.event_id
    where a.user_id = $1 and e.starts_at <= now() and e.status <> 'cancelado' and a.status <> 'pendiente' order by e.starts_at`, [userId]);
  const went = (s: string) => s === 'presente' || s === 'retraso';
  const c = await one<any>(`select
      (select count(*) from event_rsvp where user_id = $1)::int as rsvp,
      (select count(distinct ref_id) from material_usage where user_id = $1 and kind = 'marcha')::int as marchas,
      (select count(*) from lesson_progress where user_id = $1 and completed_at is not null)::int as lessons,
      (select count(*) from exercise_results where user_id = $1 and correct)::int as exercises,
      (select count(*) from doubts where author_id = $1)::int as doubts,
      (select count(*) from announcement_reads where user_id = $1)::int as reads,
      (select count(*) from webauthn_credentials where user_id = $1)::int as passkeys,
      (select count(*) from marchas where owner_id = $1)::int as own`, [userId]);
  const days = (await q<any>(`select day from study_days where user_id = $1 order by day`, [userId])).map((r) => new Date(r.day).getTime());
  let studyRun = 0, run = 0;
  days.forEach((d, i) => { run = i && d - days[i - 1] <= 86400000 * 1.5 ? run + 1 : 1; studyRun = Math.max(studyRun, run); });
  const since = new Date(u.joined_at ?? u.created_at).getTime();
  const value: Record<string, number> = {
    asistencia: att.filter((a) => went(a.status)).length,
    racha: bestRun(att, (a) => went(a.status), (a) => a.status === 'justificada'),
    puntual: bestRun(att, (a) => a.status === 'presente', (a) => a.status === 'justificada'),
    procesion: att.filter((a) => went(a.status) && a.type === 'procesion').length,
    escenario: att.filter((a) => went(a.status) && (a.type === 'actuacion' || a.type === 'concierto')).length,
    confirma: c.rsvp, repertorio: c.marchas, estudio: studyRun, oido: c.exercises, academia: c.lessons,
    dudas: c.doubts, avisos: c.reads, veterano: Math.max(0, Math.floor((Date.now() - since) / 86400000)),
    faceid: c.passkeys > 0 ? 1 : 0, arreglista: c.own > 0 ? 1 : 0,
  };
  const items = DEFS.map((d) => {
    const v = value[d.id] ?? 0;
    const level = d.levels.filter((l) => v >= l).length; // 0 = aún no
    const next = d.levels[level] ?? null;
    // los de un solo paso son directamente de oro
    const tier = level === 0 ? null : d.levels.length === 1 ? 'Oro' : LEVEL_NAMES[level - 1];
    return {
      id: d.id, title: d.title, icon: d.icon, unit: d.unit ? d.unit.split('|')[v === 1 ? 0 : 1] : '', value: v, levels: d.levels, level, tier,
      max: level === d.levels.length, next, goal: next != null ? d.desc(next) : d.desc(d.levels[d.levels.length - 1]),
      tierNext: next != null ? (d.levels.length === 1 ? 'Oro' : LEVEL_NAMES[level]) : null,
    };
  });
  return { user: { id: u.id, name: u.name }, items, medals: items.reduce((a, i) => a + i.level, 0), total: DEFS.reduce((a, d) => a + d.levels.length, 0) };
}

achievementsRouter.get('/', h(async (req, res) => { res.json(await achievementsFor(req.user!.id)); }));

// la dirección puede ver los logros de cualquier componente (en su ficha)
achievementsRouter.get('/:userId', h(async (req, res) => {
  const id = String(req.params.userId);
  if (id !== req.user!.id && !(req.user!.role === 'director' || can(req.user, 'members.manage'))) throw new HttpError(403, 'Sin permiso.');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, 'No existe ese componente.');
  res.json(await achievementsFor(id));
}));
