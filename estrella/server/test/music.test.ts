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
