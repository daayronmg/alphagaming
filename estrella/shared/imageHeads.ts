/**
 * Cabezas de nota en una partitura fotografiada o escaneada (sin texto musical dentro).
 * Visión por ordenador sencilla y rápida, sin dependencias:
 *   1. tinta = píxeles oscuros (umbral de Otsu)
 *   2. inclinación de la foto y líneas del pentagrama (proyección horizontal)
 *   3. se borran las líneas, se rellenan los huecos de las blancas/redondas
 *   4. apertura morfológica con un disco: sobreviven las cabezas, caen plicas, barras y líneas
 * Cada cabeza sale con su posición en el pentagrama (0 = línea inferior, pares = en línea).
 * Puede colarse algún borrón: quien la usa la empareja con las notas reales y descarta lo que no cuadra.
 */

export interface ImgHead { x: number; y: number; w: number; h: number; pos: number; staff: number; s: number; below: number }

function otsu(g: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.length; i += 3) hist[g[i]]++;
  let total = 0, sum = 0;
  for (let i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
  let wB = 0, sB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

/** Distancia (chaflán 3-4, en píxeles) de cada píxel marcado al más cercano sin marcar. */
function distance(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!d[i]) continue;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 3);
    if (y > 0) { v = Math.min(v, d[i - w] + 3); if (x > 0) v = Math.min(v, d[i - w - 1] + 4); if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4); }
    else v = Math.min(v, 3);
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (!d[i]) continue;
    let v = d[i];
    if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
    if (y < h - 1) { v = Math.min(v, d[i + w] + 3); if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4); if (x > 0) v = Math.min(v, d[i + w - 1] + 4); }
    else v = Math.min(v, 3);
    d[i] = v;
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

/** Componentes conexas (4 vecinos) de los píxeles con valor `val`; llama a `fn` con sus píxeles. */
function components(m: Uint8Array, w: number, h: number, val: number, fn: (px: Int32Array, n: number, box: [number, number, number, number], border: boolean) => void) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  for (let s0 = 0; s0 < m.length; s0++) {
    if (seen[s0] || m[s0] !== val) continue;
    let top = 0, n = 0; stack[top++] = s0; seen[s0] = 1;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, border = false;
    const list: number[] = [];
    while (top) {
      const i = stack[--top]; list.push(i); n++;
      const x = i % w, y = (i / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x > 0 && !seen[i - 1] && m[i - 1] === val) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && !seen[i + 1] && m[i + 1] === val) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (y > 0 && !seen[i - w] && m[i - w] === val) { seen[i - w] = 1; stack[top++] = i - w; }
      if (y < h - 1 && !seen[i + w] && m[i + w] === val) { seen[i + w] = 1; stack[top++] = i + w; }
    }
    fn(Int32Array.from(list), n, [x0, y0, x1, y1], border);
  }
}

export function detectImageHeads(gray: Uint8Array, w: number, h: number): ImgHead[] {
  const thr = Math.min(170, otsu(gray));
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = gray[i] < thr ? 1 : 0;

  // inclinación: el ángulo con la proyección horizontal más «afilada»
  const cx = w / 2;
  const proj = (t: number, step: number) => {
    const H = new Float64Array(h + Math.ceil(Math.abs(t) * w) + 2);
    const off = Math.ceil(Math.abs(t) * cx) + 1;
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (ink[y * w + x]) { const yy = Math.round(y - (x - cx) * t) + off; if (yy >= 0 && yy < H.length) H[yy]++; }
    return { H, off };
  };
  let bestT = 0, bestV = -1;
  for (let a = -3; a <= 3.001; a += 0.25) {
    const t = Math.tan((a * Math.PI) / 180);
    const { H } = proj(t, 2);
    let v = 0; for (const c of H) v += c * c;
    if (v > bestV) { bestV = v; bestT = t; }
  }
  const off = Math.ceil(Math.abs(bestT) * cx) + 1;
  const HL = h + 2 * off + 2;
  const yAt = (yy: number, x: number) => yy - off + (x - cx) * bestT; // fila «enderezada» → fila real en x
  // pentagramas por franjas verticales: así se siguen aunque la foto esté algo curvada
  const NS = 8, SW = w / NS;
  type Cand = { k: number; lines: number[]; th: number; s: number; c: number };
  const cands: Cand[] = [];
  for (let k = 0; k < NS; k++) {
    // perfil de «oscuridad» (no solo tinta): en fotos las líneas salen grises y finas
    const H = new Float64Array(HL);
    const xa = Math.floor(k * SW), xb = Math.floor((k + 1) * SW);
    for (let y = 0; y < h; y++) for (let x = xa; x < xb; x++) { const v = gray[y * w + x]; if (v < 235) H[Math.round(y - (x - cx) * bestT) + off] += (235 - v) / 235; }
    const S = (y: number) => H[y - 1] + H[y] + H[y + 1];
    const lines: { y: number; th: number; v: number }[] = [];
    for (let y = 2; y < HL - 2; y++) {
      const v = S(y);
      if (v < SW * 0.45 || v < S(y - 1) || v <= S(y + 1)) continue;
      const cy = (H[y - 1] * (y - 1) + H[y] * y + H[y + 1] * (y + 1)) / v;
      let th = 1; for (let q = y - 3; q <= y + 3; q++) if (q !== y && H[q] >= H[y] * 0.5) th++;
      if (lines.length && cy - lines[lines.length - 1].y < 3) continue;
      lines.push({ y: cy, th, v });
    }
    // tramos de líneas a la misma distancia; si hay más de cinco (líneas adicionales, barras),
    // el pentagrama son las cinco más oscuras seguidas
    for (let i = 0; i + 4 < lines.length;) {
      const g0 = lines[i + 1].y - lines[i].y;
      let e = i + 1;
      while (e + 1 < lines.length && Math.abs(lines[e + 1].y - lines[e].y - g0) < g0 * 0.3) e++;
      if (g0 < 4 || e - i < 4) { i++; continue; }
      let best = i, bv = -1;
      for (let j = i; j + 4 <= e; j++) { const v = lines.slice(j, j + 5).reduce((a, l) => a + l.v, 0); if (v > bv) { bv = v; best = j; } }
      const ls = lines.slice(best, best + 5);
      cands.push({ k, lines: ls.map((l) => l.y), th: Math.max(...ls.map((l) => l.th)), s: (ls[4].y - ls[0].y) / 4, c: (ls[0].y + ls[4].y) / 2 });
      i = e + 1;
    }
  }
  if (!cands.length) return [];
  const s = cands.map((c) => c.s).sort((a, b) => a - b)[cands.length >> 1];
  // las franjas de un mismo pentagrama se juntan por su altura
  cands.sort((a, b) => a.c - b.c);
  const groups: Cand[][] = [];
  for (const c of cands) {
    const g = groups[groups.length - 1];
    if (g && c.c - g[0].c < 3 * s) g.push(c); else groups.push([c]);
  }
  const staves = groups.map((g0) => {
    // las franjas que no coinciden con la mayoría (se han ido una línea arriba o abajo) se descartan
    const med = [...g0].sort((a, b) => a.c - b.c)[g0.length >> 1].c;
    return g0.filter((c, i) => Math.abs(c.c - med) < 0.5 * s && !g0.some((o, j) => j < i && o.k === c.k && Math.abs(o.c - med) < 0.5 * s));
  }).filter((g) => g.length >= 2).map((g) => {
    g.sort((a, b) => a.k - b.k);
    const th = Math.max(...g.map((c) => c.th));
    const ss = g.reduce((a, c) => a + c.s, 0) / g.length;
    /** las cinco líneas (fila enderezada) en la columna x, interpolando entre franjas */
    const at = (x: number): number[] => {
      const xs = g.map((c) => (c.k + 0.5) * SW);
      if (x <= xs[0]) return g[0].lines;
      if (x >= xs[xs.length - 1]) return g[g.length - 1].lines;
      let j = 0; while (xs[j + 1] < x) j++;
      const t = (x - xs[j]) / (xs[j + 1] - xs[j]);
      return g[j].lines.map((l, q) => l + (g[j + 1].lines[q] - l) * t);
    };
    return { th, s: ss, at };
  });
  if (!staves.length) return [];

  // se borran las líneas donde no tocan nada por encima ni por debajo
  for (const st of staves) {
    const half = Math.ceil(st.th / 2) + 1;
    for (let x = 0; x < w; x++) for (const ly of st.at(x)) {
      const yc = Math.round(yAt(ly, x));
      const a = yc - half - 1, b = yc + half + 1;
      if (a < 0 || b >= h) continue;
      if (!ink[a * w + x] && !ink[b * w + x]) for (let y = a + 1; y < b; y++) ink[y * w + x] = 0;
    }
  }
  // huecos pequeños (el interior de una blanca o redonda) → se rellenan
  components(ink, w, h, 0, (px, n, [x0, y0, x1, y1], border) => {
    if (border || n > 1.6 * s * s || x1 - x0 > 2 * s || y1 - y0 > 1.3 * s) return;
    for (let k = 0; k < n; k++) ink[px[k]] = 1;
  });
  // apertura con un disco de radio ~0,37 espacios: solo quedan las cabezas (y algún borrón grueso)
  const r = Math.max(1.5, s * 0.37);
  const d1 = distance(ink, w, h);
  const seeds = new Uint8Array(w * h);
  for (let i = 0; i < seeds.length; i++) seeds[i] = d1[i] >= r ? 0 : 1; // 0 = semilla (fondo para la distancia)
  const d2 = distance(seeds, w, h);
  const heads = new Uint8Array(w * h);
  for (let i = 0; i < heads.length; i++) heads[i] = ink[i] && d2[i] <= r ? 1 : 0;

  const out: ImgHead[] = [];
  components(heads, w, h, 1, (px, n, [x0, y0, x1, y1]) => {
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw < 0.8 * s || bw > 2.3 * s || bh < 0.6 * s || bh > 1.6 * s || n < 0.45 * s * s) return;
    let sx = 0, sy = 0; for (let k = 0; k < n; k++) { sx += px[k] % w; sy += (px[k] / w) | 0; }
    const hx = sx / n, hy = sy / n;
    const yy = hy - (hx - cx) * bestT + off; // fila enderezada
    let si = 0, bd = Infinity;
    staves.forEach((st, k) => { const l = st.at(hx); const dd = Math.abs((l[0] + l[4]) / 2 - yy); if (dd < bd) { bd = dd; si = k; } });
    const st = staves[si]; const l = st.at(hx);
    if (yy < l[0] - 4.5 * st.s || yy > l[4] + 4.5 * st.s) return;
    const pos = Math.round((l[4] - yy) / (st.s / 2));
    out.push({ x: x0, y: y0, w: bw, h: bh, pos, staff: si, s: st.s, below: yAt(l[4], hx) + 2.6 * st.s });
  });
  // orden de lectura; en acordes, la más aguda
  out.sort((a, b) => a.staff - b.staff || a.x - b.x || a.y - b.y);
  return out.filter((hd, i) => !out.some((o, j) => j < i && o.staff === hd.staff && Math.abs(o.x - hd.x) < 0.6 * hd.s));
}
