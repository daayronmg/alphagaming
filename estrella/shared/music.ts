// Modelo musical interno de ESTRELLA (compartido por servidor y cliente).
// Representa una parte (una voz de un instrumento) como datos estructurados editables.

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export type Dur = 'w' | 'h' | 'q' | '8' | '16' | '32';
export type Clef = 'treble' | 'bass' | 'percussion';
export type Articulation = 'staccato' | 'accent' | 'tenuto' | 'marcato' | 'fermata';
export type Dynamic = 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'sfz' | 'cresc' | 'dim';

export interface Note {
  id: string;
  rest?: boolean;
  step?: Step;
  octave?: number;
  /** alteración real de la nota en semitonos (-2..2), ya combinada con la armadura */
  alter?: number;
  dur: Dur;
  dots?: number;
  tie?: boolean;
  artic?: Articulation[];
  dyn?: Dynamic;
}

export interface Measure {
  id: string;
  /** número de compás compartido entre todas las partes de una marcha */
  n: number;
  notes: Note[];
  /** letra de ensayo o nombre de sección (Introducción, A, B, Trío…) */
  mark?: string;
  repeatStart?: boolean;
  repeatEnd?: boolean;
}

export interface ScoreDoc {
  schema: 1;
  title: string;
  clef: Clef;
  /** armadura en quintas: >0 sostenidos, <0 bemoles */
  key: number;
  time: [number, number];
  tempo: number;
  /** semitonos de lo escrito a lo que suena (corneta en Sib = -2) */
  transposition: number;
  measures: Measure[];
}

export const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_SEMI = [0, 2, 4, 5, 7, 9, 11];
export const STEP_ES: Record<Step, string> = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };
export const DUR_QUARTERS: Record<Dur, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25, '32': 0.125 };
export const DUR_ES: Record<Dur, string> = { w: 'redonda', h: 'blanca', q: 'negra', '8': 'corchea', '16': 'semicorchea', '32': 'fusa' };
export const DURS: Dur[] = ['w', 'h', 'q', '8', '16', '32'];

export function uid(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function noteQuarters(n: Pick<Note, 'dur' | 'dots'>): number {
  const base = DUR_QUARTERS[n.dur];
  if (n.dots === 1) return base * 1.5;
  if (n.dots === 2) return base * 1.75;
  return base;
}
export function measureCapacity(time: [number, number]): number {
  return (time[0] * 4) / time[1];
}
export function measureFill(m: Measure): number {
  return m.notes.reduce((a, n) => a + noteQuarters(n), 0);
}

/** Posición diatónica de la nota escrita respecto a la línea inferior del pentagrama (0 = 1ª línea, 1 = 1er espacio…). */
export function staffPosition(step: Step, octave: number, clef: Clef): number {
  const idx = octave * 7 + STEPS.indexOf(step);
  // Clave de sol: 1ª línea = Mi4. Clave de fa: 1ª línea = Sol2. Percusión: se usa la colocación de clave de sol.
  const bottom = clef === 'bass' ? 2 * 7 + 4 : 4 * 7 + 2;
  return idx - bottom;
}

export type StaffPlacement = 'linea' | 'fuera';
/**
 * Clasificación para el código de color de cornetas.
 * 'linea' (rojo): la cabeza de nota está sobre una de las cinco líneas del pentagrama.
 * 'fuera' (azul): espacios, líneas adicionales y cualquier posición fuera de las cinco líneas.
 * Se calcula a partir de la posición escrita en el pentagrama, nunca de la altura que suena.
 */
export function placement(pos: number): StaffPlacement {
  return pos >= 0 && pos <= 8 && pos % 2 === 0 ? 'linea' : 'fuera';
}
export function describePosition(pos: number): string {
  if (pos >= 0 && pos <= 8) return pos % 2 === 0 ? `${pos / 2 + 1}ª línea` : `${(pos - 1) / 2 + 1}º espacio`;
  if (pos < 0) {
    const k = -pos;
    return k % 2 === 0 ? `${k / 2}ª línea adicional inferior` : k === 1 ? 'debajo del pentagrama' : `debajo de la ${(k - 1) / 2}ª línea adicional inferior`;
  }
  const k = pos - 8;
  return k % 2 === 0 ? `${k / 2}ª línea adicional superior` : k === 1 ? 'encima del pentagrama' : `encima de la ${(k - 1) / 2}ª línea adicional superior`;
}

const SHARP_ORDER: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
export function keyAlter(step: Step, key: number): number {
  if (key > 0) return SHARP_ORDER.slice(0, key).includes(step) ? 1 : 0;
  if (key < 0) return FLAT_ORDER.slice(0, -key).includes(step) ? -1 : 0;
  return 0;
}
export const KEY_NAMES: Record<number, string> = {
  [-7]: 'Do♭ M', [-6]: 'Sol♭ M', [-5]: 'Re♭ M', [-4]: 'La♭ M', [-3]: 'Mi♭ M', [-2]: 'Si♭ M', [-1]: 'Fa M',
  0: 'Do M', 1: 'Sol M', 2: 'Re M', 3: 'La M', 4: 'Mi M', 5: 'Si M', 6: 'Fa♯ M', 7: 'Do♯ M',
};

/** Alteraciones accidentales que hay que mostrar en un compás (dependen de la armadura y de notas previas del compás). */
export function accidentalsFor(m: Measure, key: number): (string | null)[] {
  const state = new Map<string, number>();
  return m.notes.map((n) => {
    if (n.rest || !n.step || n.octave == null) return null;
    const k = `${n.step}${n.octave}`;
    const current = state.has(k) ? state.get(k)! : keyAlter(n.step, key);
    const a = n.alter ?? 0;
    if (a === current) return null;
    state.set(k, a);
    return a === 0 ? 'n' : a === 1 ? '#' : a === -1 ? 'b' : a === 2 ? '##' : 'bb';
  });
}

export function midiOf(step: Step, octave: number, alter = 0): number {
  return 12 * (octave + 1) + STEP_SEMI[STEPS.indexOf(step)] + alter;
}
export const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export function noteName(n: Pick<Note, 'step' | 'octave' | 'alter' | 'rest'>, withOctave = true): string {
  if (n.rest || !n.step) return 'silencio';
  const alt = n.alter === 1 ? '♯' : n.alter === -1 ? '♭' : n.alter === 2 ? '𝄪' : n.alter === -2 ? '𝄫' : '';
  return `${STEP_ES[n.step]}${alt}${withOctave && n.octave != null ? n.octave : ''}`;
}

export function transposeDiatonic(n: Note, steps: number): Note {
  if (n.rest || !n.step || n.octave == null) return n;
  const idx = n.octave * 7 + STEPS.indexOf(n.step) + steps;
  return { ...n, step: STEPS[((idx % 7) + 7) % 7], octave: Math.floor(idx / 7) };
}

export function emptyScore(title: string, opts: Partial<ScoreDoc> = {}, measures = 8): ScoreDoc {
  const time = opts.time ?? [2, 4];
  const doc: ScoreDoc = {
    schema: 1, title, clef: opts.clef ?? 'treble', key: opts.key ?? 0, time, tempo: opts.tempo ?? 80,
    transposition: opts.transposition ?? 0, measures: [],
  };
  for (let i = 1; i <= measures; i++) doc.measures.push(restMeasure(i, time));
  return doc;
}
export function restMeasure(n: number, time: [number, number]): Measure {
  const cap = measureCapacity(time);
  const notes: Note[] = [];
  let left = cap;
  for (const d of DURS) {
    while (left >= DUR_QUARTERS[d] - 1e-9) { notes.push({ id: uid(), rest: true, dur: d }); left -= DUR_QUARTERS[d]; }
  }
  return { id: uid(), n, notes };
}

export function renumber(doc: ScoreDoc): ScoreDoc {
  doc.measures.forEach((m, i) => (m.n = i + 1));
  return doc;
}

// ===== Validación estructural (el servidor no confía en el cliente) =====
export function validateScore(d: any): string | null {
  if (!d || typeof d !== 'object') return 'Partitura vacía';
  if (d.schema !== 1) return 'Versión de formato desconocida';
  if (typeof d.title !== 'string') return 'Falta el título';
  if (!['treble', 'bass', 'percussion'].includes(d.clef)) return 'Clave no válida';
  if (!Number.isInteger(d.key) || d.key < -7 || d.key > 7) return 'Armadura no válida';
  if (!Array.isArray(d.time) || d.time.length !== 2 || ![1, 2, 4, 8, 16].includes(d.time[1]) || !(d.time[0] >= 1 && d.time[0] <= 16)) return 'Compás no válido';
  if (!(d.tempo >= 20 && d.tempo <= 300)) return 'Tempo fuera de rango (20–300)';
  if (!Number.isInteger(d.transposition) || Math.abs(d.transposition) > 24) return 'Transposición no válida';
  if (!Array.isArray(d.measures) || d.measures.length > 2000) return 'Lista de compases no válida';
  const ids = new Set<string>();
  for (const m of d.measures) {
    if (typeof m.id !== 'string' || !Number.isInteger(m.n) || !Array.isArray(m.notes)) return 'Compás mal formado';
    if (m.notes.length > 128) return `Demasiadas notas en el compás ${m.n}`;
    for (const n of m.notes) {
      if (typeof n.id !== 'string' || ids.has(n.id)) return `Identificador de nota repetido o ausente (compás ${m.n})`;
      ids.add(n.id);
      if (!DURS.includes(n.dur)) return `Duración no válida (compás ${m.n})`;
      if (n.dots != null && ![0, 1, 2].includes(n.dots)) return `Puntillo no válido (compás ${m.n})`;
      if (!n.rest) {
        if (!STEPS.includes(n.step) || !Number.isInteger(n.octave) || n.octave < 0 || n.octave > 9) return `Altura no válida (compás ${m.n})`;
        if (n.alter != null && (!Number.isInteger(n.alter) || Math.abs(n.alter) > 2)) return `Alteración no válida (compás ${m.n})`;
      }
    }
  }
  return null;
}

// ===== Diferencias entre versiones (para el historial) =====
export interface ScoreChange { measure: number; kind: 'añadido' | 'eliminado' | 'modificado' | 'cabecera'; detail: string; noteIds?: string[] }

function noteSig(n: Note) {
  return JSON.stringify([n.rest ? 'r' : `${n.step}${n.octave}${n.alter ?? 0}`, n.dur, n.dots ?? 0, n.tie ?? false, (n.artic ?? []).join(','), n.dyn ?? '']);
}
function describeNote(n: Note) {
  const base = n.rest ? `silencio de ${DUR_ES[n.dur]}` : `${noteName(n)} ${DUR_ES[n.dur]}`;
  return base + (n.dots ? ' con puntillo' : '') + (n.artic?.length ? ` (${n.artic.join(', ')})` : '') + (n.dyn ? ` [${n.dyn}]` : '');
}

export function diffScores(a: ScoreDoc | null, b: ScoreDoc): ScoreChange[] {
  const out: ScoreChange[] = [];
  if (!a) return [{ measure: 0, kind: 'cabecera', detail: `Versión inicial con ${b.measures.length} compases` }];
  if (a.key !== b.key) out.push({ measure: 0, kind: 'cabecera', detail: `Armadura: ${KEY_NAMES[a.key]} → ${KEY_NAMES[b.key]}` });
  if (a.time.join('/') !== b.time.join('/')) out.push({ measure: 0, kind: 'cabecera', detail: `Compás: ${a.time.join('/')} → ${b.time.join('/')}` });
  if (a.tempo !== b.tempo) out.push({ measure: 0, kind: 'cabecera', detail: `Tempo: ${a.tempo} → ${b.tempo}` });
  if (a.clef !== b.clef) out.push({ measure: 0, kind: 'cabecera', detail: `Clave: ${a.clef} → ${b.clef}` });
  const am = new Map(a.measures.map((m) => [m.id, m]));
  const bm = new Map(b.measures.map((m) => [m.id, m]));
  for (const m of b.measures) {
    const old = am.get(m.id);
    if (!old) { out.push({ measure: m.n, kind: 'añadido', detail: `Compás ${m.n} añadido` }); continue; }
    const details: string[] = [];
    const changed: string[] = [];
    const on = new Map(old.notes.map((n) => [n.id, n]));
    for (const n of m.notes) {
      const o = on.get(n.id);
      if (!o) { details.push(`+ ${describeNote(n)}`); changed.push(n.id); }
      else if (noteSig(o) !== noteSig(n)) { details.push(`${describeNote(o)} → ${describeNote(n)}`); changed.push(n.id); }
    }
    const nn = new Set(m.notes.map((n) => n.id));
    for (const o of old.notes) if (!nn.has(o.id)) details.push(`− ${describeNote(o)}`);
    if ((old.mark ?? '') !== (m.mark ?? '')) details.push(`sección: «${old.mark ?? ''}» → «${m.mark ?? ''}»`);
    if (!!old.repeatStart !== !!m.repeatStart || !!old.repeatEnd !== !!m.repeatEnd) details.push('barras de repetición');
    if (details.length) out.push({ measure: m.n, kind: 'modificado', detail: details.join('; '), noteIds: changed });
  }
  for (const m of a.measures) if (!bm.has(m.id)) out.push({ measure: m.n, kind: 'eliminado', detail: `Compás ${m.n} eliminado` });
  return out;
}

/** Lista legible de notas de un rango de compases (para el asistente: datos verificables). */
export function describeMeasures(doc: ScoreDoc, from: number, to: number): string {
  return doc.measures
    .filter((m) => m.n >= from && m.n <= to)
    .map((m) => {
      const fill = measureFill(m);
      const cap = measureCapacity(doc.time);
      const warn = Math.abs(fill - cap) > 1e-6 ? ` (¡atención! el compás suma ${fill} negras y debería sumar ${cap})` : '';
      return `Compás ${m.n}${m.mark ? ` [${m.mark}]` : ''}: ${m.notes.map((n) => {
        const pos = !n.rest && n.step && n.octave != null ? staffPosition(n.step, n.octave, doc.clef) : null;
        return describeNote(n) + (pos != null ? ` · ${describePosition(pos)}` : '');
      }).join(', ')}${warn}`;
    })
    .join('\n');
}
