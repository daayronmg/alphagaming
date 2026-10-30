/**
 * Lectura de partituras en PDF vectorial (exportadas por Sibelius con las fuentes Opus).
 * No es reconocimiento de imagen: las cabezas de nota, silencios y alteraciones vienen en el PDF como
 * caracteres de una fuente musical con su posición exacta, y las líneas del pentagrama, plicas y barras
 * como trazos. Con eso se reconstruyen las notas escritas.
 *
 * El resultado es una transcripción automática: cada compás cuya duración no cuadra con el compás
 * se marca para revisar, y la dirección decide si la publica.
 */
import { uid, measureCapacity, noteQuarters, keyAlter, STEPS, type Dur, type Measure, type Note, type ScoreDoc, type Step } from './music.ts';

// ===== Extracción (a partir de la lista de operaciones de pdf.js) =====

export interface Glyph { ch: string; font: string; x: number; y: number; size: number }
/** Trazo recto en coordenadas de página (y hacia abajo). */
export interface Seg { x0: number; y0: number; x1: number; y1: number; w: number }
/** Figura rellena (barras de corchea, ligaduras, barras gruesas…). */
export interface Poly { pts: [number, number][]; x0: number; y0: number; x1: number; y1: number; curved: boolean }
export interface PageShapes { width: number; height: number; glyphs: Glyph[]; segs: Seg[]; polys: Poly[] }

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * Recorre la lista de operaciones de una página de pdf.js y devuelve glifos, trazos y figuras rellenas.
 * `OPS` es pdfjs.OPS; `fontName` traduce el identificador de fuente cargada a su nombre.
 */
export function shapesFromOperatorList(
  ol: { fnArray: number[]; argsArray: any[] }, OPS: Record<string, number>,
  view: { width: number; height: number; x0: number; y0: number }, fontName: (id: string) => string,
): PageShapes {
  const glyphs: Glyph[] = [];
  const segs: Seg[] = [];
  const polys: Poly[] = [];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: { ctm: M; lw: number }[] = [];
  let lw = 1;
  let font = ''; let fsize = 0; let tm: M = [1, 0, 0, 1, 0, 0]; let tx = 0; let ty = 0; let lx = 0; let ly = 0; let cs = 0; let ws = 0; let hs = 1;
  // subtrayectos del trazado en curso, en coordenadas de página
  let subs: { pts: [number, number][]; curved: boolean }[] = [];
  const toPage = (x: number, y: number): [number, number] => { const [a, b] = apply(ctm, x, y); return [a - view.x0, view.height - (b - view.y0)]; };
  const scaleOf = (m: M) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const flush = (fill: boolean, stroke: boolean) => {
    const s = scaleOf(ctm);
    for (const sp of subs) {
      if (sp.pts.length < 2) continue;
      if (fill) {
        const xs = sp.pts.map((p) => p[0]); const ys = sp.pts.map((p) => p[1]);
        polys.push({ pts: sp.pts, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), curved: sp.curved });
      } else if (stroke) {
        for (let k = 1; k < sp.pts.length; k++) segs.push({ x0: sp.pts[k - 1][0], y0: sp.pts[k - 1][1], x1: sp.pts[k][0], y1: sp.pts[k][1], w: lw * s });
      }
    }
    subs = [];
  };
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i]; const a = ol.argsArray[i];
    switch (fn) {
      case OPS.save: stack.push({ ctm, lw }); break;
      case OPS.restore: { const s = stack.pop(); if (s) { ctm = s.ctm; lw = s.lw; } break; }
      case OPS.transform: ctm = mul(a as M, ctm); break;
      case OPS.setLineWidth: lw = a[0]; break;
      case OPS.beginText: tm = [1, 0, 0, 1, 0, 0]; tx = ty = lx = ly = 0; break;
      case OPS.setFont: font = fontName(a[0]).replace(/^[A-Z]{6}\+/, ''); fsize = a[1]; break;
      case OPS.setCharSpacing: cs = a[0]; break;
      case OPS.setWordSpacing: ws = a[0]; break;
      case OPS.setHScale: hs = a[0] / 100; break;
      case OPS.setTextMatrix: tm = a as M; tx = ty = lx = ly = 0; break;
      case OPS.moveText: tx = lx += a[0]; ty = ly += a[1]; break;
      case OPS.showText: case OPS.showSpacedText: case OPS.nextLineShowText: case OPS.nextLineSetSpacingShowText: {
        const items = fn === OPS.nextLineSetSpacingShowText ? a[2] : a[0];
        const size = Math.abs(fsize) * scaleOf(mul(tm, ctm));
        for (const g of items ?? []) {
          if (typeof g === 'number') { tx -= (g * Math.abs(fsize)) / 1000 * hs; continue; }
          if (!g) { tx += ws * hs; continue; }
          const [x, y] = toPage(...apply(tm, tx, ty));
          if (g.unicode && g.unicode.trim()) glyphs.push({ ch: g.unicode, font, x, y, size });
          tx += ((g.width ?? 0) * Math.abs(fsize) / 1000 + cs + (g.isSpace ? ws : 0)) * hs;
        }
        break;
      }
      case OPS.constructPath: {
        const [ops, args] = a; let j = 0;
        let cur: { pts: [number, number][]; curved: boolean } | null = null;
        let start: [number, number] = [0, 0];
        const to = (x: number, y: number) => { if (!cur) { cur = { pts: [toPage(x, y)], curved: false }; subs.push(cur); } else cur.pts.push(toPage(x, y)); };
        for (const op of ops) {
          if (op === OPS.rectangle) {
            const [x, y, w, h] = args.slice(j, j + 4); j += 4;
            subs.push({ pts: [toPage(x, y), toPage(x + w, y), toPage(x + w, y + h), toPage(x, y + h), toPage(x, y)], curved: false }); cur = null;
          } else if (op === OPS.moveTo) { cur = null; start = [args[j], args[j + 1]]; to(args[j++], args[j++]); }
          else if (op === OPS.lineTo) to(args[j++], args[j++]);
          else if (op === OPS.curveTo) { to(args[j], args[j + 1]); to(args[j + 2], args[j + 3]); to(args[j + 4], args[j + 5]); if (cur) (cur as any).curved = true; j += 6; }
          else if (op === OPS.curveTo2 || op === OPS.curveTo3) { to(args[j], args[j + 1]); to(args[j + 2], args[j + 3]); if (cur) (cur as any).curved = true; j += 4; }
          else if (op === OPS.closePath) { to(...start); cur = null; }
        }
        break;
      }
      case OPS.stroke: case OPS.closeStroke: flush(false, true); break;
      case OPS.fill: case OPS.eoFill: flush(true, false); break;
      case OPS.fillStroke: case OPS.eoFillStroke: case OPS.closeFillStroke: case OPS.closeEOFillStroke: flush(true, true); break;
      case OPS.endPath: subs = []; break;
    }
  }
  return { width: view.width, height: view.height, glyphs, segs, polys };
}

// ===== Reconstrucción de la parte =====

export interface Transcription {
  doc: ScoreDoc;
  /** compases cuya duración no cuadra con el compás: hay que revisarlos */
  review: number[];
  notes: number;
  warnings: string[];
}

interface Staff { top: number; bottom: number; s: number; x0: number; x1: number; page: number }
interface Ev { x: number; kind: 'note' | 'rest' | 'measureRest'; y: number; glyph: Glyph; dur: Dur; dots: number; pos?: number; alter?: number | null; tie?: boolean; artic: Set<Note['artic'] extends (infer A)[] | undefined ? A : never>; dyn?: Note['dyn'] }

const isMusic = (g: Glyph) => g.font === 'OpusStd' || g.font === 'OpusSpecialStd';
const HEADS: Record<string, Dur> = { 'œ': 'q', '˙': 'h', 'w': 'w' };
const RESTS: Record<string, Dur> = { 'Œ': 'q', '‰': '8', '≈': '16', 'Ó': 'h' };
const FLAGS: Record<string, Dur> = { J: '8', j: '8', R: '16', r: '16' };
const ACC: Record<string, number> = { '#': 1, b: -1, n: 0 };
const DYNS = ['pp', 'p', 'mp', 'mf', 'f', 'ff', 'sfz'];
const DUR_BY_BEAMS: Dur[] = ['q', '8', '16', '32'];

function findStaves(p: PageShapes, page: number): Staff[] {
  const lines = p.segs.filter((s) => Math.abs(s.y0 - s.y1) < 0.3 && Math.abs(s.x1 - s.x0) > 60)
    .map((s) => ({ y: (s.y0 + s.y1) / 2, x0: Math.min(s.x0, s.x1), x1: Math.max(s.x0, s.x1) }))
    .sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const uniq: typeof lines = [];
  for (const l of lines) if (!uniq.some((u) => Math.abs(u.y - l.y) < 0.3 && Math.abs(u.x0 - l.x0) < 2)) uniq.push(l);
  const staves: Staff[] = [];
  const used = new Set<number>();
  for (let i = 0; i < uniq.length; i++) {
    if (used.has(i)) continue;
    const run = [i];
    for (let j = i + 1; j < uniq.length && run.length < 5; j++) {
      const prev = uniq[run[run.length - 1]];
      const gap = uniq[j].y - prev.y;
      if (Math.abs(uniq[j].x0 - uniq[i].x0) > 3 || used.has(j)) continue;
      if (run.length === 1 ? gap > 2.5 && gap < 9 : Math.abs(gap - (uniq[run[1]].y - uniq[run[0]].y)) < 0.4) run.push(j);
      else if (gap > 9) break;
    }
    if (run.length === 5) {
      run.forEach((k) => used.add(k));
      const top = uniq[run[0]].y; const bottom = uniq[run[4]].y;
      staves.push({ top, bottom, s: (bottom - top) / 4, x0: uniq[i].x0, x1: uniq[i].x1, page });
    }
  }
  return staves;
}

/** Altura media de una figura rellena (barra de corchea) en la vertical x. */
function polyYAt(q: Poly, x: number): number {
  const left = q.pts.filter((p) => p[0] < q.x0 + 0.5); const right = q.pts.filter((p) => p[0] > q.x1 - 0.5);
  const yl = left.reduce((a, p) => a + p[1], 0) / (left.length || 1); const yr = right.reduce((a, p) => a + p[1], 0) / (right.length || 1);
  return q.x1 - q.x0 < 0.01 ? yl : yl + ((yr - yl) * (x - q.x0)) / (q.x1 - q.x0);
}

function restsFor(capacity: number): Note[] {
  const out: Note[] = [];
  let left = capacity;
  for (const [dur, q] of [['w', 4], ['h', 2], ['q', 1], ['8', 0.5], ['16', 0.25]] as [Dur, number][]) {
    while (left >= q * 1.5 - 1e-9 && q < 4) { out.push({ id: uid(), rest: true, dur, dots: 1 }); left -= q * 1.5; }
    while (left >= q - 1e-9) { out.push({ id: uid(), rest: true, dur }); left -= q; }
  }
  return out;
}

/**
 * Transcribe una parte a partir de las páginas extraídas.
 * Pensado para una sola voz por pentagrama (partes de corneta, trompeta…): si hay acordes se toma la nota más aguda.
 */
export function transcribe(pages: PageShapes[], opts: { title: string; transposition: number; tempo?: number }): Transcription {
  const warnings: string[] = [];
  const measures: Measure[] = [];
  const review: number[] = [];
  let key: number | null = null;
  let firstKey: number | null = null;
  let openVolta = 0;
  let pendingKey: number | null = null;
  const capOf = new Map<Measure, number>();
  let time: [number, number] | null = null;
  let firstTime: [number, number] | null = null;
  let tempo = opts.tempo ?? 0;
  let chords = 0;
  let pendingTie: { pos: number } | null = null;
  let nextN = 1;
  let started = false;

  pages.forEach((p, pi) => {
    const staves = findStaves(p, pi + 1);
    const music = p.glyphs.filter(isMusic);
    const text = p.glyphs.filter((g) => !isMusic(g) && g.font !== 'OpusTextStd');
    if (!tempo) {
      for (const eq of p.glyphs.filter((g) => g.ch === '=')) {
        const digits = p.glyphs.filter((g) => /\d/.test(g.ch) && Math.abs(g.y - eq.y) < eq.size * 0.3 && g.x > eq.x && g.x < eq.x + eq.size * 2.5).sort((a, b) => a.x - b.x).map((g) => g.ch).join('');
        if (Number(digits) >= 30 && Number(digits) <= 240) { tempo = Number(digits); break; }
      }
    }
    const dynGlyphs = p.glyphs.filter((g) => g.font === 'OpusTextStd' && /[fpmsz]/.test(g.ch)).sort((a, b) => a.y - b.y || a.x - b.x);
    for (const st of staves) {
      const { s } = st;
      const inStaff = (g: { x: number; y: number }, above = 6, below = 6) => g.y > st.top - above * s && g.y < st.bottom + below * s && g.x > st.x0 - 2 && g.x < st.x1 + 2;
      const own = music.filter((g) => inStaff(g) && staves.every((o) => o === st || Math.abs(o.top + o.s * 2 - g.y) >= Math.abs(st.top + 2 * s - g.y)));
      const headSize = s * 4;
      const heads = own.filter((g) => HEADS[g.ch] && g.font === 'OpusStd' && g.size > headSize * 0.82);
      const headW = 1.18 * s; // ancho aproximado de una cabeza de nota
      const xs = own.map((g) => g.x);
      // barras de compás: trazos verticales que ocupan exactamente el pentagrama y no son plicas
      const vert = p.segs.filter((v) => Math.abs(v.x0 - v.x1) < 0.4 && Math.abs(Math.min(v.y0, v.y1) - st.top) < 0.7 && Math.abs(Math.max(v.y0, v.y1) - st.bottom) < 0.7 && v.x0 > st.x0 - 1 && v.x0 < st.x1 + 1);
      const thick = p.polys.filter((q) => !q.curved && q.x1 - q.x0 < s && Math.abs(q.y0 - st.top) < 0.8 && Math.abs(q.y1 - st.bottom) < 0.8);
      let bars = [...vert.map((v) => v.x0), ...thick.map((q) => (q.x0 + q.x1) / 2)]
        .filter((x) => !heads.some((h) => (Math.abs(x - h.x) < 1 || Math.abs(x - (h.x + headW)) < 1.2) && (Math.abs(h.y - st.top) < s * 0.8 || Math.abs(h.y - st.bottom) < s * 0.8 || true) && ((h.y > st.top - 0.3 * s && h.y < st.top + 0.6 * s) || (h.y > st.bottom - 0.6 * s && h.y < st.bottom + 0.3 * s))))
        .sort((a, b) => a - b);
      bars = bars.filter((x, i) => i === 0 || x - bars[i - 1] > 2.5 * s);
      if (!bars.length || st.x1 - bars[bars.length - 1] > 2 * s) bars.push(st.x1);
      const repeatStartX = own.filter((g) => g.ch === '°').map((g) => g.x);
      const repeatEndX = own.filter((g) => g.ch === 'ü').map((g) => g.x);
      const isRepeatDot = (g: Glyph) => g.ch === '™' && [...repeatStartX, ...repeatEndX].some((x) => Math.abs(g.x - x) < 2.5 * s);

      // cabecera del sistema: clave, armadura y compás
      const firstEvX = Math.min(...own.filter((g) => (HEADS[g.ch] || RESTS[g.ch] || g.ch === '∑') && g.font === 'OpusStd').map((g) => g.x), bars[0]);
      if (own.some((g) => g.ch === '?' && g.x < firstEvX)) { if (!warnings.includes('clave de fa')) warnings.push('clave de fa'); }
      const keyAcc = own.filter((g) => (g.ch === '#' || g.ch === 'b') && g.font === 'OpusStd' && g.x < firstEvX && g.y > st.top - 2 * s && g.y < st.bottom + s);
      // cada sistema repite la armadura vigente
      const sysKey = keyAcc.length ? (keyAcc[0].ch === '#' ? keyAcc.length : -keyAcc.length) : 0;
      if (key === null) firstKey = sysKey;
      key = sysKey;
      const tsGlyphs = own.filter((g) => g.font === 'OpusStd' && g.size < headSize * 1.1 && /^[0-9cC]$/.test(g.ch) && g.y > st.top - 0.5 * s && g.y < st.bottom + 0.5 * s);
      // indicaciones de compás del sistema (al principio o a mitad), de izquierda a derecha
      const timeAt: { x: number; t: [number, number] }[] = [];
      for (const g of [...tsGlyphs].sort((a, b) => a.x - b.x)) {
        if (timeAt.some((t) => Math.abs(t.x - g.x) < 3 * s)) continue;
        if (g.ch === 'c' || g.ch === 'C') { timeAt.push({ x: g.x, t: g.ch === 'c' ? [4, 4] : [2, 2] }); continue; }
        const col = tsGlyphs.filter((o) => Math.abs(o.x - g.x) < 3 * s && /\d/.test(o.ch));
        const up = col.filter((o) => o.y < st.top + 2 * s).sort((a, b) => a.x - b.x).map((o) => o.ch).join('');
        const down = col.filter((o) => o.y > st.top + 2 * s).sort((a, b) => a.x - b.x).map((o) => o.ch).join('');
        if (up && down && [1, 2, 4, 8, 16].includes(Number(down))) timeAt.push({ x: g.x, t: [Number(up), Number(down)] });
      }
      if (!time && timeAt.length) firstTime = timeAt[0].t;
      // tresillos: «3» pequeño junto a las notas
      const triplets = p.glyphs.filter((g) => g.ch === '3' && g.size < headSize * 1.2 && g.y > st.top - 8 * s && g.y < st.bottom + 8 * s && g.x > st.x0 + 6 * s && g.x < st.x1
        && !dynGlyphs.includes(g) && staves.every((o) => o === st || Math.abs(o.top + o.s * 2 - g.y) >= Math.abs(st.top + 2 * s - g.y) - 2 * s)
        // no es un número de compás (cifras pegadas o justo encima de una barra)
        && !p.glyphs.some((d) => d !== g && /\d/.test(d.ch) && Math.abs(d.y - g.y) < 1 && Math.abs(d.x - g.x) < g.size * 0.8)
        && !(g.y < st.top && bars.some((b) => Math.abs(b - g.x) < 2 * s)));
      // casillas de 1ª y 2ª vez: «1.» / «2.» encima del pentagrama bajo un corchete
      const voltas = text.filter((g) => (g.ch === '1' || g.ch === '2') && g.y < st.top + s && g.y > st.top - 9 * s && g.x > st.x0 && g.x < st.x1 + 3 * s
        && text.some((d) => d.ch === '.' && d.x > g.x && d.x < g.x + g.size && Math.abs(d.y - g.y) < 2))
        .map((g) => {
          const br = p.segs.find((v) => Math.abs(v.y0 - v.y1) < 0.3 && v.y0 < g.y && v.y0 > g.y - 3 * s && Math.min(v.x0, v.x1) < g.x + s && Math.min(v.x0, v.x1) > g.x - 2.5 * s && Math.abs(v.x1 - v.x0) > 3 * s);
          return { n: Number(g.ch), x0: br ? Math.min(br.x0, br.x1) : g.x - s, x1: br ? Math.max(br.x0, br.x1) : g.x + s };
        });
      // casilla que viene del sistema anterior: el corchete continúa desde el principio sin número
      if (openVolta) {
        const cont = p.segs.find((v) => Math.abs(v.y0 - v.y1) < 0.3 && v.y0 < st.top - 0.5 * s && v.y0 > st.top - 9 * s && Math.min(v.x0, v.x1) < st.x0 + 14 * s && Math.abs(v.x1 - v.x0) > 4 * s
          && !voltas.some((w) => Math.abs(w.x0 - Math.min(v.x0, v.x1)) < s));
        if (cont) voltas.push({ n: openVolta, x0: st.x0, x1: Math.max(cont.x0, cont.x1) });
      }
      openVolta = [...voltas].sort((a, b) => b.x0 - a.x0).find((v) => v.x1 > st.x1 - 2 * s)?.n ?? 0;
      const mnum = text.filter((g) => /\d/.test(g.ch) && g.x < st.x0 + 4 * s && g.y < st.top && g.y > st.top - 4 * s).sort((a, b) => a.x - b.x).map((g) => g.ch).join('');

      // compases del sistema
      let left = st.x0;
      bars.forEach((bx, bi) => {
        const mStart = left;
        left = bx;
        for (const t of timeAt) if (t.x >= mStart - 0.5 && t.x < bx) time = t.t;
        if (pendingKey !== null) { key = pendingKey; pendingKey = null; }
        const cap = time ? measureCapacity(time) : firstTime ? measureCapacity(firstTime) : 4;
        const inM = (g: { x: number }) => g.x >= mStart - 0.5 && g.x < bx - 0.5;
        const mGlyphs = own.filter(inM);
        const events: Ev[] = [];
        // silencio de varios compases: barra gruesa horizontal en el centro y número encima
        const multi = p.polys.find((q) => !q.curved && q.x1 - q.x0 > 6 * s && q.y1 - q.y0 < s && q.y0 > st.top + s && q.y1 < st.bottom - s && q.x0 >= mStart - 1 && q.x1 <= bx + 1);
        if (multi) {
          const digits = music.filter((g) => /\d/.test(g.ch) && g.y < st.top && g.y > st.top - 4 * s && g.x > multi.x0 - s && g.x < multi.x1 + s).sort((a, b) => a.x - b.x).map((g) => g.ch).join('');
          const count = Number(digits) || 1;
          for (let k = 0; k < count; k++) { const m: Measure = { id: uid(), n: nextN++, notes: restsFor(cap) }; capOf.set(m, cap); measures.push(m); }
          started = true;
          return;
        }
        const hs = heads.filter(inM).sort((a, b) => a.x - b.x || a.y - b.y);
        if (!(mStart === st.x0)) {
          const loose = mGlyphs.filter((g) => g.ch in ACC && g.font === 'OpusStd' && g.size > headSize * 0.82 && !hs.some((h) => h.x > g.x && h.x < g.x + 3.5 * s && Math.abs(h.y - g.y) < 0.6 * s));
          if (loose.length) {
            const sharps = loose.filter((g) => g.ch === '#').length; const flats = loose.filter((g) => g.ch === 'b').length;
            const nk = sharps ? sharps : flats ? -flats : 0;
            const firstX = Math.min(...hs.map((h) => h.x), ...mGlyphs.filter((g) => RESTS[g.ch]).map((g) => g.x), bx);
            if (Math.max(...loose.map((g) => g.x)) < firstX) key = nk; else pendingKey = nk;
          }
        }
        // acordes: se queda la nota más aguda
        const single = hs.filter((h, i) => { const dup = hs.findIndex((o) => Math.abs(o.x - h.x) < headW * 0.9); if (dup !== i) { chords++; return false; } return true; });
        for (const h of single) {
          const pos = Math.round((st.bottom - h.y) / (s / 2));
          let dur = HEADS[h.ch];
          if (dur === 'q') {
            const flag = mGlyphs.find((g) => FLAGS[g.ch] && g.font === 'OpusStd' && g.x > h.x - headW && g.x < h.x + headW * 1.6 && Math.abs(g.y - h.y) < 5 * s);
            if (flag) dur = FLAGS[flag.ch];
            else {
              const stem = p.segs.find((v) => Math.abs(v.x0 - v.x1) < 0.4 && (Math.abs(v.x0 - h.x) < 1.2 || Math.abs(v.x0 - (h.x + headW)) < 1.5) && (Math.abs(v.y0 - h.y) < s || Math.abs(v.y1 - h.y) < s) && Math.abs(v.y1 - v.y0) > 2 * s);
              if (stem) {
                const near = Math.abs(stem.y0 - h.y) < Math.abs(stem.y1 - h.y) ? stem.y0 : stem.y1;
                const tip = near === stem.y0 ? stem.y1 : stem.y0;
                const up = tip < near;
                const beams = p.polys.filter((q) => !q.curved && q.x0 - 0.8 <= stem.x0 && q.x1 + 0.8 >= stem.x0 && q.y1 - q.y0 < 3 * s && q.x1 - q.x0 > 0.8 * s)
                  .filter((q) => { const y = polyYAt(q, stem.x0); return up ? y > tip - 0.6 * s && y < tip + 2.6 * s : y < tip + 0.6 * s && y > tip - 2.6 * s; });
                dur = DUR_BY_BEAMS[Math.min(beams.length, 3)];
              }
            }
          }
          const next = [...single, ...mGlyphs.filter((g) => RESTS[g.ch])].filter((o) => o.x > h.x + headW * 0.5).reduce((a, o) => Math.min(a, o.x), bx);
          const dots = mGlyphs.filter((g) => g.ch === '™' && !isRepeatDot(g) && g.x > h.x + headW * 0.6 && g.x < Math.min(next, h.x + headW + 3 * s) && Math.abs(g.y - h.y) < 0.8 * s).length;
          const accG = mGlyphs.find((g) => g.ch in ACC && g.font === 'OpusStd' && g.x < h.x && g.x > h.x - 3.5 * s && Math.abs(g.y - h.y) < 0.6 * s && !keyAcc.includes(g));
          const artic = new Set<any>();
          for (const g of mGlyphs) {
            if (Math.abs(g.x - h.x) > headW * 1.4 || Math.abs(g.y - h.y) > 5 * s) continue;
            if (g.ch === '>') artic.add('accent');
            if (g.ch === '-') artic.add('tenuto');
            if (g.ch === '^') artic.add('marcato');
            if (g.ch === 'U' || g.ch === 'u') artic.add('fermata');
            if (g.ch === '.' && Math.abs(g.y - h.y) > 0.8 * s) artic.add('staccato');
          }
          events.push({ x: h.x, kind: 'note', y: h.y, glyph: h, dur, dots: Math.min(dots, 2), pos, alter: accG ? ACC[accG.ch] : null, artic });
        }
        for (const r of mGlyphs.filter((g) => (RESTS[g.ch] || g.ch === '∑') && g.font === 'OpusStd' && g.size > headSize * 0.82)) {
          if (r.ch === '∑') { events.push({ x: r.x, kind: 'measureRest', y: r.y, glyph: r, dur: 'w', dots: 0, artic: new Set() }); continue; }
          const dots = mGlyphs.filter((g) => g.ch === '™' && !isRepeatDot(g) && g.x > r.x + 0.5 * s && g.x < r.x + 3 * s && Math.abs(g.y - r.y) < 2 * s).length;
          events.push({ x: r.x, kind: 'rest', y: r.y, glyph: r, dur: RESTS[r.ch], dots: Math.min(dots, 1), artic: new Set() });
        }
        if (!events.length) {
          // tramo vacío (cabecera sin notas o hueco entre barras dobles)
          if (bi === bars.length - 1 && !started) return;
          if (!mGlyphs.some((g) => g.x > firstEvX - 1)) return;
        }
        events.sort((a, b) => a.x - b.x);
        // dinámicas: grupos de letras bajo el pentagrama
        const dyns = dynGlyphs.filter((g) => g.y > st.bottom && g.y < st.bottom + 5 * s && g.x >= mStart - 1 && g.x < bx);
        const groups: { x: number; t: string }[] = [];
        for (const g of dyns.sort((a, b) => a.x - b.x)) { const last = groups[groups.length - 1]; if (last && g.x - last.x < 1.2 * s * last.t.length + s) last.t += g.ch; else groups.push({ x: g.x, t: g.ch }); }
        for (const d of groups) { const ev = events.find((e) => e.kind === 'note' && e.x >= d.x - 2 * s); if (ev && DYNS.includes(d.t)) ev.dyn = d.t as Note['dyn']; }

        const accMem = new Map<number, number>();
        const notes: Note[] = [];
        for (const e of events) {
          if (e.kind === 'measureRest') { notes.push(...restsFor(cap)); continue; }
          if (e.kind === 'rest') { notes.push({ id: uid(), rest: true, dur: e.dur, ...(e.dots ? { dots: e.dots } : {}) }); continue; }
          const idx = 4 * 7 + 2 + e.pos!;
          const step = STEPS[((idx % 7) + 7) % 7] as Step;
          const octave = Math.floor(idx / 7);
          if (e.alter != null) accMem.set(e.pos!, e.alter);
          const alter = accMem.get(e.pos!) ?? keyAlter(step, key ?? 0);
          const n: Note = { id: uid(), step, octave, dur: e.dur, ...(alter ? { alter } : {}), ...(e.dots ? { dots: e.dots } : {}) };
          if (e.artic.size) n.artic = [...e.artic];
          if (e.dyn) n.dyn = e.dyn;
          // ligadura de prolongación: curva que sale de esta nota hacia la siguiente de la misma altura
          const tie = p.polys.find((q) => q.curved && q.x0 > e.x - 0.5 * s && q.x0 < e.x + headW + 1.5 * s && Math.abs((q.y0 + q.y1) / 2 - e.y) < 2.2 * s && q.x1 - q.x0 > 1.5 * s);
          if (tie) (n as any)._tieTo = tie.x1;
          if (pendingTie && pendingTie.pos === e.pos && measures.length) {
            const prev = [...measures[measures.length - 1].notes].reverse().find((x) => !x.rest);
            if (prev) prev.tie = true;
          }
          pendingTie = null;
          notes.push(n);
        }
        // une las ligaduras dentro del compás
        for (let k = 0; k < notes.length; k++) {
          const n = notes[k] as any;
          if (n._tieTo == null) continue;
          const nx = notes.slice(k + 1).find((x) => !x.rest);
          const ei = events.filter((e) => e.kind === 'note');
          const target = ei.find((e) => Math.abs(e.x - n._tieTo) < 2.5 * s);
          if (nx && target && nx.step === n.step && nx.octave === n.octave) n.tie = true;
          else if (!nx && n._tieTo > bx - 2 * s) pendingTie = { pos: events.filter((e) => e.kind === 'note').slice(-1)[0].pos! };
          delete n._tieTo;
        }
        // tresillos: se marca el grupo de notas centrado bajo cada «3» cuya duración escrita es la de un tresillo
        const evIdx = events.map((e, k) => ({ e, k })).filter(({ e }) => e.kind !== 'measureRest');
        for (const t3 of triplets.filter((g) => g.x >= mStart && g.x < bx)) {
          let best: { a: number; b: number; d: number } | null = null;
          for (let a = 0; a < evIdx.length; a++) for (let b = a; b < Math.min(evIdx.length, a + 6); b++) {
            const group = evIdx.slice(a, b + 1).map(({ k }) => notes[k]);
            if (!group.length || group.some((n) => n.triplet)) continue;
            const sum = group.reduce((acc, n) => acc + noteQuarters(n), 0);
            // un tresillo son tres unidades de la figura más breve del grupo (3 corcheas, negra + corchea…)
            const unit = Math.min(...group.map((n) => noteQuarters(n)));
            if (![0.75, 1.5, 3].some((v) => Math.abs(v - sum) < 1e-6) || Math.abs(sum - 3 * unit) > 1e-6) continue;
            const cx = (evIdx[a].e.x + evIdx[b].e.x + headW) / 2;
            const d = Math.abs(cx - t3.x);
            if (d < 4 * s && (!best || d < best.d)) best = { a, b, d };
          }
          if (best) for (let k = best.a; k <= best.b; k++) notes[evIdx[k].k].triplet = true;
        }
        const m: Measure = { id: uid(), n: nextN, notes };
        capOf.set(m, cap);
        // el corchete suele empezar un poco antes de la barra del compás al que pertenece
        const v = voltas.find((v) => mStart >= v.x0 - 5 * s && mStart < v.x1 - 2 * s);
        if (v) m.volta = v.n;
        if (repeatStartX.some((x) => x > mStart - 2 * s && x < mStart + 2 * s) || repeatStartX.some((x) => x >= mStart && x < (events[0]?.x ?? bx))) m.repeatStart = true;
        if (repeatEndX.some((x) => x > bx - 3 * s && x < bx + 2 * s)) m.repeatEnd = true;
        // número de compás impreso al principio del sistema: manda sobre el contador
        if (mStart === st.x0 && mnum && Number(mnum) > 0 && measures.length) {
          if (Number(mnum) !== nextN) { warnings.push(`compás ${nextN}: el PDF indica ${mnum}`); m.n = nextN = Number(mnum); }
        }
        nextN++;
        started = true;
        measures.push(m);
      });
    }
  });
  const docTime: [number, number] = firstTime ?? [4, 4];
  if (!firstTime) warnings.push('No se ha encontrado el compás: se supone 4/4.');
  measures.forEach((m, i) => {
    const cap = capOf.get(m) ?? measureCapacity(docTime);
    const fill = m.notes.reduce((a, n) => a + noteQuarters(n), 0);
    // la anacrusa (primer compás incompleto) y el último compás pueden ser más cortos
    if (Math.abs(fill - cap) > 1e-6 && !(fill < cap && (i === 0 || i === measures.length - 1))) review.push(m.n);
  });
  if (chords) warnings.push(`${chords} notas dobles: se ha tomado la más aguda.`);
  const doc: ScoreDoc = { schema: 1, title: opts.title, clef: 'treble', key: firstKey ?? 0, time: docTime, tempo: tempo || 90, transposition: opts.transposition, measures };
  return { doc, review, notes: measures.reduce((a, m) => a + m.notes.filter((n) => !n.rest).length, 0), warnings };
}
