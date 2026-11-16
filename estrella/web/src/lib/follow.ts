import { midiOf, STEPS, STEP_ES, cornetPosition, type Note, type ScoreDoc } from '../../../shared/music';
import type { NoteHead } from '../../../shared/pdfMusic';
import type { HeadSource as Transcription } from './pdf';

/** Lo que se dibuja encima del original para una nota: dónde está, su nombre y (corneta) su posición de llave. */
export interface OverlayHead extends NoteHead { name: string; key: '|' | '—' | null }

const pitched = (d: ScoreDoc) => d.measures.flatMap((m) => m.notes.map((n) => (m.transpose ? { ...n, _tr: m.transpose } : n))).filter((n) => !n.rest && n.step) as (Note & { step: NonNullable<Note['step']>; _tr?: number })[];
const midi = (n: Note) => midiOf(n.step!, n.octave!, n.alter ?? 0);
/** altura escrita sin alteración (lo único que se ve seguro en una foto) */
const diat = (n: Note) => n.octave! * 7 + STEPS.indexOf(n.step!);

/**
 * Empareja las notas que se reproducen (la partitura publicada, quizá corregida por la dirección)
 * con las cabezas de nota del PDF original, por orden y altura (subsecuencia común más larga).
 * Devuelve las cabezas rotuladas, con el id de la nota publicada cuando se ha podido emparejar.
 */
const cache = new WeakMap<Transcription, { doc: ScoreDoc; cornet: boolean; out: OverlayHead[] }>();
export function followHeads(tr: Transcription, doc: ScoreDoc, cornet: boolean): OverlayHead[] {
  const c = cache.get(tr);
  if (c && c.doc === doc && c.cornet === cornet) return c.out;
  const out = computeHeads(tr, doc, cornet);
  cache.set(tr, { doc, cornet, out });
  return out;
}

function computeHeads(tr: Transcription, doc: ScoreDoc, cornet: boolean): OverlayHead[] {
  const a = pitched(tr.doc); // notas leídas del PDF (mismo orden que las cabezas)
  const b = pitched(doc);
  const headOf = new Map(tr.heads.map((h) => [h.id, h]));
  const pair = new Map<string, Note>(); // id de la nota del PDF → nota publicada
  const n = a.length, m = b.length;
  if (n && m && n * m <= 4_000_000) {
    const am = a.map(diat), bm = b.map(diat);
    // tabla de la subsecuencia común más larga (de atrás adelante) en filas compactas
    const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = am[i] === bm[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (am[i] === bm[j]) { pair.set(a[i].id, b[j]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) i++;
      else j++;
    }
    // casi nada coincide (p. ej. otra tonalidad): si hay las mismas notas, se emparejan por orden
    if (pair.size < Math.min(n, m) * 0.5 && n === m) { pair.clear(); a.forEach((x, k) => pair.set(x.id, b[k])); }
  }
  const out: OverlayHead[] = [];
  for (const x of a) {
    const h = headOf.get(x.id);
    if (!h) continue;
    const p = pair.get(x.id);
    if (!p && tr.approx) continue; // en fotos solo se señalan las que cuadran con la música
    const src = p ?? x;
    const alt = src.alter ?? 0;
    out.push({
      ...h, id: p?.id ?? `pdf:${x.id}`,
      name: `${STEP_ES[src.step!]}${alt > 0 ? '♯' : alt < 0 ? '♭' : ''}`,
      key: cornet ? cornetPosition(midi(src) + doc.transposition + ((src as any)._tr ?? 0)) : null,
    });
  }
  return out;
}
