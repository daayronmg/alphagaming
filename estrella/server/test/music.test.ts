import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staffPosition, placement, describePosition, diffScores, validateScore, emptyScore, accidentalsFor, keyAlter, type ScoreDoc } from '../../shared/music.ts';
import { parseCsv, toCsv } from '../src/lib/csv.ts';
import { applyCommand, initialState, positionAt, START_LEAD_MS, type LiveState } from '../src/routes/live.ts';

test('posición en el pentagrama y código de color (clave de sol)', () => {
  // líneas: Mi4 Sol4 Si4 Re5 Fa5 → rojo
  for (const [s, o] of [['E', 4], ['G', 4], ['B', 4], ['D', 5], ['F', 5]] as const) assert.equal(placement(staffPosition(s, o, 'treble')), 'linea', `${s}${o}`);
  // espacios → azul
  for (const [s, o] of [['F', 4], ['A', 4], ['C', 5], ['E', 5]] as const) assert.equal(placement(staffPosition(s, o, 'treble')), 'fuera', `${s}${o}`);
  // líneas adicionales (Do4, La5) y fuera del pentagrama (Re4, Sol5) → azul
  for (const [s, o] of [['C', 4], ['A', 5], ['D', 4], ['G', 5]] as const) assert.equal(placement(staffPosition(s, o, 'treble')), 'fuera', `${s}${o}`);
  assert.equal(describePosition(staffPosition('C', 4, 'treble')), '1ª línea adicional inferior');
  assert.equal(describePosition(staffPosition('G', 4, 'treble')), '2ª línea');
});

test('el color depende de la posición escrita y de la clave, no del sonido', () => {
  // Sol2 es la 1ª línea en clave de fa, pero estaría muy por debajo en clave de sol
  assert.equal(placement(staffPosition('G', 2, 'bass')), 'linea');
  assert.equal(placement(staffPosition('G', 2, 'treble')), 'fuera');
});

test('alteraciones según la armadura', () => {
  assert.equal(keyAlter('F', 1), 1);
  assert.equal(keyAlter('B', -1), -1);
  const doc = emptyScore('x', { key: 1 }, 1);
  doc.measures[0].notes = [
    { id: 'a', step: 'F', octave: 5, alter: 1, dur: 'q' },  // Fa# por armadura: sin accidental
    { id: 'b', step: 'F', octave: 5, alter: 0, dur: 'q' },  // becuadro
    { id: 'c', step: 'F', octave: 5, alter: 0, dur: 'q' },  // ya anulado en el compás
  ];
  assert.deepEqual(accidentalsFor(doc.measures[0], 1), [null, 'n', null]);
});

test('validación y diferencias entre versiones', () => {
  const a = emptyScore('x', {}, 2);
  assert.equal(validateScore(a), null);
  assert.match(validateScore({ ...a, tempo: 5 }) ?? '', /Tempo/);
  const b: ScoreDoc = structuredClone(a);
  b.measures[1].notes[0] = { ...b.measures[1].notes[0], rest: false, step: 'G', octave: 4, alter: 0 };
  const d = diffScores(a, b);
  assert.equal(d.length, 1);
  assert.equal(d[0].measure, 2);
  assert.match(d[0].detail, /Sol4/);
});

test('CSV con punto y coma (Excel en español) y comillas', () => {
  const rows = parseCsv('﻿nombre;correo\n"García, Ana";ana@x.es\r\nLuis;"luis@x.es"\n');
  assert.deepEqual(rows, [['nombre', 'correo'], ['García, Ana', 'ana@x.es'], ['Luis', 'luis@x.es']]);
  assert.match(toCsv([['=SUMA(A1)']]), /'=SUMA/); // se neutralizan fórmulas
});

test('dirección en directo: arranque programado, posición y bucle', async () => {
  let s: LiveState = { ...initialState(), marchaId: 'm', marchaTitle: 'x', totalMeasures: 24, tempo: 120, beatsPerMeasure: 2 };
  const t0 = 1_000_000;
  s = await applyCommand(s, { type: 'play', fromMeasure: 5 }, t0);
  assert.equal(s.transport.anchorTs, t0 + START_LEAD_MS);
  assert.equal(positionAt(s, t0), 5); // durante la cuenta atrás
  // 120 ppm, 2 tiempos por compás → 1 compás por segundo
  assert.equal(Math.floor(positionAt(s, t0 + START_LEAD_MS + 3000)), 8);
  s = await applyCommand(s, { type: 'pause' }, t0 + START_LEAD_MS + 3000);
  assert.equal(s.transport.status, 'paused');
  assert.equal(s.measure, 8);
  s = await applyCommand(s, { type: 'loop', loop: { from: 10, to: 11 } }, t0);
  s = await applyCommand(s, { type: 'play' }, t0);
  assert.equal(Math.floor(positionAt(s, t0 + START_LEAD_MS + 2500)), 10); // vuelve al inicio del bucle
  s = await applyCommand(s, { type: 'step', delta: 100 }, t0);
  assert.equal(s.measure, 24); // no supera el total de compases
});

test('libreto: detección de títulos y autores por página', async () => {
  const { detectBook, validateBook } = await import('../../shared/book.ts');
  const page = (items: [string, number, number, number][]) => ({ width: 842, height: 595, items: items.map(([str, x, y, size]) => ({ str, x, y, size })) });
  const staff: [string, number, number, number][] = [['Corneta 3ª', 39, 90, 15], ['J', 100, 94, 17], ['w', 200, 90, 17], ['p', 120, 107, 9]];
  const pages = [
    page([['Semana Santa 2026', 61, 52, 11], ['1 ¡A esta es!', 347, 51, 36], ['Antonio Jesús Castaño López', 666, 57, 11], ['Manuel Alejandro González Cruz', 646, 69, 11], ...staff]),
    page(staff), // continuación sin cabecera
    page([['Semana Santa 2026', 35, 71, 11], ['Al cielo el Rey de Triana', 287, 42, 30], ['A Juan Pérez', 700, 60, 11], ['Rafael Vázquez Mateo', 576, 78, 11], ...staff]),
    page([['Retreta Floreada', 267, 75, 36], ['V.25', 515, 75, 40], ...staff]),
  ];
  const book = detectBook(pages);
  assert.deepEqual(book, [
    { title: '¡A esta es!', composer: 'Antonio Jesús Castaño López / Manuel Alejandro González Cruz', from: 1, to: 2 },
    { title: 'Al cielo el Rey de Triana', composer: 'Rafael Vázquez Mateo', from: 3, to: 3 },
    { title: 'Retreta Floreada V.25', composer: '', from: 4, to: 4 },
  ]);
  assert.equal(validateBook(book, 4), null);
  assert.match(validateBook([{ title: 'A', composer: '', from: 1, to: 2 }, { title: 'B', composer: '', from: 2, to: 2 }], 4)!, /solapa/);
  assert.match(validateBook([{ title: ' ', composer: '', from: 1, to: 1 }], 4)!, /título/);
});

test('repeticiones con casillas y tresillos', async () => {
  const { playOrder, noteQuarters, measureFill } = await import('../../shared/music.ts');
  const ms = [1, 2, 3, 4, 5].map((n) => ({ id: String(n), n, notes: [] as any[] })) as any[];
  ms[1].repeatStart = true; ms[2].repeatEnd = true; ms[2].volta = 1; ms[3].volta = 2;
  assert.deepEqual(playOrder(ms).map((m: any) => m.n), [1, 2, 3, 2, 4, 5]);
  assert.deepEqual(playOrder([{ id: 'a', n: 1, notes: [], repeatEnd: true }, { id: 'b', n: 2, notes: [] }] as any).map((m: any) => m.n), [1, 1, 2]);
  assert.ok(Math.abs(noteQuarters({ dur: '8', triplet: true }) - 1 / 3) < 1e-9);
  assert.equal(measureFill({ id: 'x', n: 1, notes: [{ id: 'a', dur: '8', triplet: true }, { id: 'b', dur: '8', triplet: true }, { id: 'c', dur: '8', triplet: true }, { id: 'd', dur: 'h', dots: 1 }] } as any), 4);
});

test('lectura de una parte en PDF vectorial (fuentes Opus de Sibelius)', async () => {
  const { transcribe } = await import('../../shared/pdfMusic.ts');
  // pentagrama: líneas cada 4 puntos (y = 100…116), clave de sol, La mayor, compás 4/4
  const s = 4; const top = 100; const bottom = top + 4 * s;
  const line = (y: number) => ({ x0: 20, y0: y, x1: 500, y1: y, w: 0.6 });
  const bar = (x: number) => ({ x0: x, y0: top, x1: x, y1: bottom, w: 0.6 });
  const stem = (x: number, y: number, up = true) => ({ x0: x, y0: y, x1: x, y1: up ? y - 3.5 * s : y + 3.5 * s, w: 0.8 });
  const g = (ch: string, x: number, y: number, font = 'OpusStd', size = 16) => ({ ch, x, y, font, size });
  const yOf = (pos: number) => bottom - pos * (s / 2); // 0 = Mi4
  const page = {
    width: 600, height: 400,
    glyphs: [
      g('&', 24, yOf(2)), g('#', 38, yOf(8)), g('#', 43, yOf(5)), g('#', 48, yOf(9)), g('c', 56, yOf(4)),
      // compás 1: Do#5 blanca con puntillo + silencio de negra
      g('˙', 80, yOf(5)), g('™', 88, yOf(5) - s / 2, 'OpusSpecialStd'), g('Œ', 140, yOf(4)),
      // compás 2: Re5 corchea con corchete, silencio de corchea, Si4 negra, La4 blanca
      g('œ', 180, yOf(6)), g('j', 180, yOf(6) + 3.5 * s), g('‰', 200, yOf(4)), g('œ', 220, yOf(4)), g('n', 250, yOf(3)), g('˙', 256, yOf(3)),
      // compás 3: dos corcheas unidas por barra y una redonda no cabe: blanca ligada
      g('œ', 320, yOf(5)), g('œ', 340, yOf(5)), g('˙', 380, yOf(5)), g('Œ', 440, yOf(4)),
      g('=', 30, 70, 'TimesNewRomanPSMT', 11), g('7', 38, 70, 'TimesNewRomanPSMT', 11), g('6', 44, 70, 'TimesNewRomanPSMT', 11),
    ],
    segs: [...[0, 1, 2, 3, 4].map((k) => line(top + k * s)), bar(170), bar(300), bar(499), stem(180 + 4.7, yOf(6)), stem(220, yOf(4), false), stem(320 + 4.7, yOf(5)), stem(340 + 4.7, yOf(5))],
    polys: [{ pts: [[324.7, yOf(5) - 3.5 * s], [344.7, yOf(5) - 3.5 * s], [344.7, yOf(5) - 3.5 * s + 2], [324.7, yOf(5) - 3.5 * s + 2]] as [number, number][], x0: 324.7, x1: 344.7, y0: yOf(5) - 3.5 * s, y1: yOf(5) - 3.5 * s + 2, curved: false }],
  };
  const t = transcribe([page], { title: 'Prueba', transposition: -2 });
  assert.equal(t.doc.key, 3);
  assert.deepEqual(t.doc.time, [4, 4]);
  assert.equal(t.doc.tempo, 76);
  const txt = t.doc.measures.map((m) => m.notes.map((n) => n.rest ? `z${n.dur}` : `${n.step}${n.alter === 1 ? '#' : n.alter === -1 ? 'b' : ''}${n.octave}${n.dur}${'.'.repeat(n.dots ?? 0)}`).join(' '));
  assert.deepEqual(txt, ['C#5h. zq', 'D5/8 z8 B4q A4h'.replace('/', ''), 'C#58 C#58 C#5h zq']);
  assert.deepEqual(t.review, []);
});
