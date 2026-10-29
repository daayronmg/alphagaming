import { Router } from 'express';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { q, one } from '../db.ts';
import { h, parse, HttpError } from '../lib/http.ts';
import { requireAuth, can } from '../lib/auth.ts';
import { config } from '../config.ts';
import { resolvePart } from './library.ts';
import { audienceMatch } from './annotations.ts';
import { myStats } from './academy.ts';
import { userAssignments } from './members.ts';
import {
  describeMeasures, staffPosition, placement, describePosition, noteName, noteQuarters, measureCapacity, DUR_ES,
  type ScoreDoc, type Note,
} from '../../../shared/music.ts';

export const assistantRouter = Router();
assistantRouter.use(requireAuth);

const client = config.anthropicKey ? new Anthropic({ apiKey: config.anthropicKey }) : null;

const body = z.object({
  message: z.string().min(1).max(2000),
  marchaId: z.string().uuid().nullable().optional(),
  scoreId: z.string().uuid().nullable().optional(),
  measureFrom: z.number().int().min(1).nullable().optional(),
  measureTo: z.number().int().min(1).nullable().optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(6000) })).max(12).default([]),
});

interface Answer { answer: string; verified: boolean; mode: 'local' | 'ia'; sources: string[]; action?: any }

function measuresFrom(text: string): [number, number] | null {
  const m = text.match(/comp[aá]s(?:es)?\s+(\d{1,4})(?:\s*(?:a|al|hasta|-|–|y)\s*(?:el\s+)?(\d{1,4}))?/i);
  if (!m) return null;
  const a = Number(m[1]); const b = m[2] ? Number(m[2]) : a;
  return [Math.min(a, b), Math.max(a, b)];
}

function rhythmOf(doc: ScoreDoc, from: number, to: number): string {
  const beat = 4 / doc.time[1];
  return doc.measures.filter((m) => m.n >= from && m.n <= to).map((m) => {
    let t = 0;
    const parts = m.notes.map((n) => {
      const start = t / beat + 1;
      t += noteQuarters(n);
      const what = n.rest ? `silencio de ${DUR_ES[n.dur]}` : `${noteName(n)} (${DUR_ES[n.dur]}${n.dots ? ' con puntillo' : ''})`;
      return `tiempo ${Number.isInteger(start) ? start : start.toFixed(2).replace(/0$/, '')}: ${what}`;
    });
    const cap = measureCapacity(doc.time) / beat;
    return `Compás ${m.n} (${doc.time.join('/')}, ${cap} tiempos): ${parts.join(' · ')}`;
  }).join('\n');
}

function routine(minutes: number, weak: any[], marcha?: string | null): string {
  const m = Math.max(5, Math.min(90, minutes));
  const block = (p: number) => Math.max(1, Math.round((m * p) / 100));
  const weakNotes = weak.filter((w) => w.exercise === 'lectura').slice(0, 4).map((w) => w.item);
  return [
    `Rutina de ${m} minutos (propuesta orientativa; adáptala a lo que indique tu responsable):`,
    `1. ${block(15)} min · Calentamiento: notas largas y suaves, cuidando que el sonido sea estable.`,
    `2. ${block(20)} min · Lectura en Academia → Entrenamiento de lectura${weakNotes.length ? `, centrándote en ${weakNotes.join(', ')} (tus fallos más frecuentes)` : ''}.`,
    `3. ${block(15)} min · Ritmo con metrónomo lento: palmea y luego toca los pasajes marcados.`,
    `4. ${block(40)} min · ${marcha ? `«${marcha}»: ` : ''}trabaja tus pasajes marcados como difíciles en bucle, al 70 % del tempo y subiendo poco a poco.`,
    `5. ${block(10)} min · Toca la marcha completa (o grabación de referencia) sin parar, aunque haya errores.`,
  ].join('\n');
}

const LANDMARKS = `Para reconocer notas sin contar desde la primera línea, memoriza unas pocas «notas ancla» y lee por distancia a ellas:
• En clave de sol: Sol (2ª línea, donde se enrosca la clave), Do central (1ª línea adicional inferior), Do agudo (3er espacio) y Sol agudo (encima del pentagrama).
• Las notas en líneas consecutivas van de tercera en tercera (Mi–Sol–Si–Re–Fa); las de los espacios también (Fa–La–Do–Mi).
• Desde un ancla: una línea más arriba = salta una nota (tercera); pasar de línea a espacio contiguo = nota siguiente.
Practícalo en Academia → Entrenamiento de lectura: el sistema registra en qué notas tardas más y te las propone con más frecuencia.`;

assistantRouter.get('/status', h(async (_req, res) => {
  res.json({ ai: !!client, model: client ? config.anthropicModel : null });
}));

assistantRouter.post('/', h(async (req, res) => {
  const b = parse(body, req.body);
  const user = req.user!;
  const text = b.message;
  const lower = text.toLowerCase();
  const stats = await myStats(user.id);
  const assignments = await userAssignments(user.id);

  // ===== Contexto verificable =====
  const sources: string[] = [];
  let doc: ScoreDoc | null = null;
  let marcha: any = null;
  let scoreLabel: string | null = null;
  if (b.marchaId) {
    marcha = await one<any>('select id, title, composer, director_notes, measures from marchas where id = $1', [b.marchaId]);
    if (!marcha) throw new HttpError(404, 'Marcha no encontrada.');
    sources.push(`Ficha de «${marcha.title}»`);
  }
  if (b.scoreId || marcha) {
    let scoreId = b.scoreId ?? null;
    if (!scoreId && marcha) scoreId = (await resolvePart(user.id, marcha.id)).score?.id ?? null;
    if (scoreId) {
      const s = await one<any>(`select s.label, sv.content, sv.number from scores s join score_versions sv on sv.id = s.published_version_id where s.id = $1`, [scoreId]);
      if (s) { doc = s.content; scoreLabel = `${s.label} (versión ${s.number})`; sources.push(`Partitura estructurada ${scoreLabel}`); }
    }
  }
  const official = marcha ? (await q<any>(`select a.measure, a.data->>'text' as text, a.audience, u.name from annotations a join users u on u.id = a.owner_id
      where a.marcha_id = $1 and a.layer = 'official' and not a.deleted and a.data->>'text' is not null order by a.measure nulls last limit 60`, [marcha.id]))
      .filter((a) => audienceMatch(user, a.audience)) : [];
  if (official.length) sources.push('Anotaciones oficiales de la dirección');

  const range = measuresFrom(text) ?? (b.measureFrom ? [b.measureFrom, b.measureTo ?? b.measureFrom] as [number, number] : null);

  // ===== Respuestas locales deterministas (siempre verificables) =====
  let local: Answer | null = null;
  if (/qu[eé] notas|notas (hay|aparecen)|dime las notas/.test(lower)) {
    if (!doc) local = { answer: 'No puedo verificar las notas: esta marcha no tiene una partitura estructurada publicada para tu voz (solo PDF o imagen). Pregunta a tu responsable o consulta el PDF original; no voy a suponer qué notas hay.', verified: false, mode: 'local', sources };
    else if (!range) local = { answer: 'Indica los compases, por ejemplo: «¿Qué notas aparecen en los compases 12 a 16?».', verified: true, mode: 'local', sources };
    else {
      const d = describeMeasures(doc, range[0], range[1]);
      local = { answer: d ? `Según ${scoreLabel}:\n${d}` : `La partitura publicada no tiene los compases ${range[0]}–${range[1]}.`, verified: !!d, mode: 'local', sources };
    }
  } else if (/ritmo/.test(lower) && range) {
    local = doc
      ? { answer: `Ritmo según ${scoreLabel} (cuenta los tiempos en voz alta):\n${rhythmOf(doc, range[0], range[1])}`, verified: true, mode: 'local', sources }
      : { answer: 'No dispongo de datos rítmicos verificables de este pasaje (solo hay PDF). Pide a la dirección la versión editable o pregunta con «Tengo una duda» sobre el fragmento.', verified: false, mode: 'local', sources };
  } else if (/rutina/.test(lower)) {
    const min = Number(lower.match(/(\d{1,2})\s*min/)?.[1] ?? 15);
    local = { answer: routine(min, stats.weak, marcha?.title), verified: true, mode: 'local', sources: [...sources, 'Tus estadísticas de ejercicios'] };
  } else if (/ejercicio/.test(lower) && /fall|equivoc|cuest/.test(lower)) {
    const items = stats.weak.filter((w: any) => w.exercise === 'lectura' && w.fails > 0).map((w: any) => w.item);
    local = items.length
      ? { answer: `He preparado una serie de lectura con las notas que más fallas: ${items.join(', ')}. Pulsa «Empezar» para practicarla.`, verified: true, mode: 'local', sources: ['Tus resultados en Entrenamiento de lectura'], action: { type: 'trainer', notes: items } }
      : { answer: 'Todavía no tengo suficientes resultados tuyos para saber qué notas fallas. Haz un par de rondas en Academia → Entrenamiento de lectura y vuelve a pedírmelo.', verified: true, mode: 'local', sources };
  } else if (/sin (tener que )?contar|reconocer (las |estas )?notas/.test(lower)) {
    local = { answer: LANDMARKS, verified: true, mode: 'local', sources: ['Contenido de la Academia (nivel 2)'] };
  } else if (/color|rojo|azul/.test(lower) && doc && range) {
    const out = doc.measures.filter((m) => m.n >= range[0] && m.n <= range[1]).flatMap((m) => m.notes.filter((n: Note) => !n.rest && n.step).map((n: Note) => {
      const pos = staffPosition(n.step!, n.octave!, doc!.clef);
      return `c.${m.n} ${noteName(n)}: ${describePosition(pos)} → ${placement(pos) === 'linea' ? 'rojo (sobre línea)' : 'azul (fuera de las líneas)'}`;
    }));
    local = { answer: out.join('\n') || 'No hay notas en esos compases.', verified: true, mode: 'local', sources };
  }

  if (!client) {
    if (local) return res.json(local);
    return res.json({
      answer: 'El asistente con IA no está activado en este servidor. Puedo responder de forma verificable a: «¿Qué notas aparecen en los compases X a Y?», «Explícame el ritmo del compás X», «Hazme una rutina de 15 minutos», «Prepárame ejercicios con las notas que más fallo» y «¿Cómo reconozco las notas sin contar?». Para dudas concretas de una partitura usa «Tengo una duda» y te responderá la dirección.',
      verified: true, mode: 'local', sources: [],
    } satisfies Answer);
  }

  // ===== IA con contexto autorizado y verificable =====
  const contextParts = [
    `Componente: ${user.name}. Asignaciones: ${assignments.map((a) => `${a.instrument}${a.voice ? ' ' + a.voice : ''}`).join(', ') || 'ninguna'}.`,
    marcha ? `Marcha: «${marcha.title}»${marcha.composer ? ` de ${marcha.composer}` : ''}. Observaciones de la dirección: ${marcha.director_notes || '(ninguna)'}` : 'No hay marcha seleccionada.',
    doc ? `Partitura estructurada ${scoreLabel}: clave ${doc.clef}, armadura ${doc.key}, compás ${doc.time.join('/')}, tempo ${doc.tempo}.\n${describeMeasures(doc, range?.[0] ?? 1, range?.[1] ?? Math.min(doc.measures.length, 64))}` : 'No hay partitura estructurada disponible: solo PDF/imagen, cuyo contenido NO conoces.',
    official.length ? `Anotaciones oficiales:\n${official.map((a) => `- ${a.measure ? `compás ${a.measure}: ` : ''}${a.text} (${a.name})`).join('\n')}` : 'Sin anotaciones oficiales con texto.',
    `Estadísticas de estudio: racha ${stats.streak} días; notas con más fallos: ${stats.weak.map((w: any) => `${w.item} (${w.fails}/${w.total})`).join(', ') || 'sin datos'}.`,
    local ? `Cálculo local verificado (úsalo literalmente si responde a la pregunta):\n${local.answer}` : '',
  ].filter(Boolean).join('\n\n');

  const system = `Eres el asistente musical de ${config.appName}, la aplicación privada de una banda de cornetas y tambores. Ayudas a los músicos a estudiar.
Reglas estrictas:
- Responde en español, con frases sencillas, como un buen profesor de banda.
- Usa SOLO la información del bloque <contexto> para cualquier afirmación sobre una partitura, una nota, una digitación o una indicación del director. Si algo no está en el contexto, di claramente que no puedes verificarlo y sugiere preguntar con «Tengo una duda».
- No inventes digitaciones de corneta ni posiciones: si no están en los materiales, dilo.
- Puedes explicar teoría musical general (lectura, ritmo, compás, figuras), indicando que es explicación general.
- No valores si un músico toca bien o mal.
- Respuestas breves y prácticas (máximo ~200 palabras salvo que se pida una rutina o lista).`;

  try {
    const response = await client.beta.messages.create({
      model: config.anthropicModel,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system,
      messages: [
        ...b.history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: `<contexto>\n${contextParts}\n</contexto>\n\nPregunta: ${text}` },
      ],
    });
    if (response.stop_reason === 'refusal') {
      return res.json({ answer: 'No puedo responder a esa consulta. Reformúlala o pregunta directamente a la dirección.', verified: false, mode: 'ia', sources } satisfies Answer);
    }
    const answer = response.content.filter((c) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
    res.json({ answer, verified: !!local?.verified, mode: 'ia', sources, action: local?.action } satisfies Answer);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return res.json(local ?? { answer: 'El asistente está saturado. Inténtalo en un minuto.', verified: false, mode: 'local', sources });
    if (e instanceof Anthropic.AuthenticationError) console.error('[asistente] clave de API no válida');
    else if (e instanceof Anthropic.APIError) console.error('[asistente] error de API', e.status, e.message);
    else console.error('[asistente]', e);
    res.json(local ?? { answer: 'El servicio de IA no está disponible ahora mismo. Puedes seguir usando las respuestas verificables (notas de un compás, ritmo, rutina, ejercicios).', verified: false, mode: 'local', sources });
  }
}));

/** Propuesta de test a partir de una lección (requiere IA). El resultado es un BORRADOR para revisar. */
assistantRouter.post('/lesson-quiz/:lessonId', h(async (req, res) => {
  if (!can(req.user, 'academy.manage') && !req.user!.leaderOf.some((l) => l.permissions.includes('lessons'))) throw new HttpError(403, 'Sin permiso.');
  if (!client) throw new HttpError(501, 'Función disponible al configurar ANTHROPIC_API_KEY en el servidor. Mientras tanto, crea las preguntas manualmente en el editor.');
  const l = await one<any>('select title, explanation, summary from lessons where id = $1', [req.params.lessonId]);
  if (!l) throw new HttpError(404, 'Lección no encontrada.');
  const response = await client.beta.messages.create({
    model: config.anthropicModel, max_tokens: 4000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'low' },
    system: 'Generas preguntas tipo test en español para una academia de música de banda, basadas EXCLUSIVAMENTE en el texto dado. Devuelve solo JSON: un array de objetos {"q": string, "options": string[4], "answer": índice correcto 0-3, "explain": string}. 5 preguntas.',
    messages: [{ role: 'user', content: `Lección «${l.title}»:\n${l.explanation}\n\nResumen: ${l.summary ?? ''}` }],
  });
  const raw = response.content.filter((c) => c.type === 'text').map((c: any) => c.text).join('');
  const json = raw.match(/\[[\s\S]*\]/)?.[0];
  let quiz: unknown;
  try { quiz = JSON.parse(json ?? '[]'); } catch { throw new HttpError(502, 'La propuesta no tiene un formato válido. Inténtalo de nuevo.'); }
  res.json({ quiz, note: 'Propuesta automática: revísala antes de guardarla.' });
}));
