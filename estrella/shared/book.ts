/**
 * Detección de marchas en un libreto PDF (varias marchas de un mismo instrumento y voz en un solo archivo).
 * Trabaja con los textos de cada página (como los da pdf.js) y propone título y autor; la dirección
 * siempre revisa la propuesta antes de importar. Si una página no tiene título se considera continuación.
 */

export interface TextItem { str: string; x: number; y: number; size: number } // y medido desde arriba
export interface PageText { width: number; height: number; items: TextItem[] }
export interface BookEntry { title: string; composer: string; from: number; to: number }

// rótulos del libreto, dedicatorias y créditos que no son el autor
const NOISE = /^(semana santa( \d{4})?|corneta|trompeta|tromb[oó]n|bombardino|caja|bombo|platos|percusi[oó]n|banda|arreglos?|adaptaci[oó]n|revisi[oó]n)\b/i;
const DEDICATION = /^(a|al|para)\s|^\(/i;
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
// los símbolos musicales llegan como letras sueltas: un texto «de verdad» tiene al menos tres letras seguidas
const isWords = (s: string) => /\p{L}{3}/u.test(s);

export function detectPage(p: PageText): { title: string; composer: string } {
  const head = p.items.filter((i) => i.str.trim() && i.y < p.height * 0.2);
  const words = p.items.filter((i) => isWords(i.str));
  if (!words.length) return { title: '', composer: '' };
  // el título es el texto de mayor tamaño de la cabecera y destaca claramente sobre los demás rótulos
  const anchor = head.filter((i) => isWords(i.str)).sort((a, b) => b.size - a.size)[0];
  if (!anchor) return { title: '', composer: '' };
  const sizes = words.filter((i) => i !== anchor).map((i) => i.size).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
  if (anchor.size < median * 1.5) return { title: '', composer: '' };
  // se añaden los fragmentos grandes de la misma línea (número de orden, «V.25»…)
  const titleItems = head.filter((i) => i === anchor || (Math.abs(i.y - anchor.y) < anchor.size * 0.5 && i.size >= anchor.size * 0.6)).sort((a, b) => a.x - b.x);
  const title = clean(titleItems.map((i) => i.str).join(' '))
    .replace(/^\d+\s*[.)-]?\s*/, '') // número de orden del libreto
    .replace(/\s+\d+$/, '')
    .replace(/"\s*([^"]*?)\s*"/g, '"$1"');
  // autor: textos a la derecha de la cabecera; si ocupa dos líneas seguidas se unen
  const right = head.filter((i) => !titleItems.includes(i) && i.x > p.width * 0.55 && i.size < anchor.size && isWords(i.str) && !NOISE.test(clean(i.str)) && !DEDICATION.test(clean(i.str)))
    .sort((a, b) => a.y - b.y);
  let composer = '';
  if (right.length) {
    const first = clean(right[0].str);
    const next = right[1] && right[1].y - right[0].y < right[0].size * 1.8 ? clean(right[1].str) : '';
    composer = !next || next === first ? first : /(,| y)$/.test(first) ? `${first} ${next}` : `${first} / ${next}`;
  }
  return { title: NOISE.test(title) ? '' : title, composer };
}

/** Propone una entrada por marcha: una página sin título se une a la marcha anterior. */
export function detectBook(pages: PageText[]): BookEntry[] {
  const out: BookEntry[] = [];
  pages.forEach((p, i) => {
    const d = detectPage(p);
    const n = i + 1;
    if (!d.title && out.length) out[out.length - 1].to = n;
    else out.push({ title: d.title || `Página ${n}`, composer: d.composer, from: n, to: n });
  });
  return out;
}

/** Comprueba que las entradas cubren páginas válidas, sin solaparse. Devuelve el error o null. */
export function validateBook(entries: BookEntry[], pageCount: number): string | null {
  if (!entries.length) return 'No hay marchas que importar.';
  let last = 0;
  for (const e of [...entries].sort((a, b) => a.from - b.from)) {
    if (!e.title.trim()) return `Falta el título de la marcha de la página ${e.from}.`;
    if (!(e.from >= 1 && e.to >= e.from && e.to <= pageCount)) return `Páginas no válidas en «${e.title}».`;
    if (e.from <= last) return `«${e.title}» se solapa con la marcha anterior.`;
    last = e.to;
  }
  return null;
}

// instrumentos que aparecen en los rótulos de las partes (sin acentos, en minúscula)
const INSTRUMENTS: [string, RegExp][] = [
  ['Corneta', /\bcornetas?\b/], ['Trompeta', /\btrompetas?\b/], ['Trombón', /\btrombon(es)?\b/],
  ['Bombardino', /\bbombardinos?\b/], ['Caja', /\b(caja|redoblante)s?\b/], ['Bombo', /\bbombos?\b/], ['Platos', /\bplatos\b/],
];
const ORDINAL: Record<string, number> = { primera: 1, primer: 1, segunda: 2, segundo: 2, tercera: 3, tercer: 3, cuarta: 4, cuarto: 4 };
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Lee el instrumento y la voz de un rótulo como «Corneta 3ª», «3ª Corneta», «Trompeta 1» o «Corneta tercera». */
export function instrumentInLabel(label: string): { instrument: string; voice: number | null } | null {
  const s = plain(label).replace(/[_.-]+/g, ' ');
  // el nombre de la banda («Banda de Cornetas y Tambores…») no es el rótulo de la parte
  if (/\bbanda\b|\btambores\b|\bcc y tt\b/.test(s)) return null;
  for (const [name, re] of INSTRUMENTS) {
    const m = re.exec(s);
    if (!m) continue;
    const after = s.slice(m.index + m[0].length), before = s.slice(0, m.index);
    const num = /^\s*(\d)\s*(ª|º|a|o)?(\s|$)/.exec(after) ?? /(^|\s)(\d)\s*(ª|º|a|o)?\s*(voz\s*)?$/.exec(before);
    const word = /^\s*(primera|primer|segunda|segundo|tercera|tercer|cuarta|cuarto)\b/.exec(after) ?? /\b(primera|primer|segunda|segundo|tercera|tercer|cuarta|cuarto)\s*$/.exec(before);
    const voice = num ? Number(num[1] && /\d/.test(num[1]) ? num[1] : num[2]) : word ? ORDINAL[word[1]] : null;
    return { instrument: name, voice: voice && voice >= 1 && voice <= 4 ? voice : null };
  }
  return null;
}

/** Instrumento y voz de un libreto: el rótulo que más se repite en sus páginas o, si no hay, el nombre del archivo. */
export function detectInstrument(pages: PageText[], fileName = ''): { instrument: string; voice: number | null } | null {
  const votes = new Map<string, number>();
  for (const p of pages) {
    const seen = new Set<string>();
    for (const it of p.items) {
      const t = it.str.trim();
      if (t.length < 4 || t.length > 40) continue;
      const d = instrumentInLabel(t);
      if (d) seen.add(`${d.instrument}|${d.voice ?? ''}`);
    }
    for (const k of seen) votes.set(k, (votes.get(k) ?? 0) + 1);
  }
  // «Corneta 3ª» y «Corneta 3» cuentan igual; si una página dice solo «Corneta», cuenta para la voz más votada
  const best = [...votes].sort((a, b) => (b[0].endsWith('|') ? 0 : 1) - (a[0].endsWith('|') ? 0 : 1) || b[1] - a[1])[0];
  if (best && best[1] >= Math.max(1, Math.ceil(pages.length * 0.3))) {
    const [instrument, v] = best[0].split('|');
    return { instrument, voice: v ? Number(v) : null };
  }
  return instrumentInLabel(fileName.replace(/\.pdf$/i, ''));
}
