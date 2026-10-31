import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instrumentInLabel, detectInstrument, type PageText } from '../../shared/book.ts';

test('rótulos de parte: instrumento y voz', () => {
  assert.deepEqual(instrumentInLabel('Corneta 3ª'), { instrument: 'Corneta', voice: 3 });
  assert.deepEqual(instrumentInLabel('Corneta 3'), { instrument: 'Corneta', voice: 3 });
  assert.deepEqual(instrumentInLabel('1ª Trompeta'), { instrument: 'Trompeta', voice: 1 });
  assert.deepEqual(instrumentInLabel('Trombón segundo'), { instrument: 'Trombón', voice: 2 });
  assert.deepEqual(instrumentInLabel('Bombardino'), { instrument: 'Bombardino', voice: null });
  assert.deepEqual(instrumentInLabel('CAJA'), { instrument: 'Caja', voice: null });
  assert.equal(instrumentInLabel('Banda de Cornetas y Tambores Estrella'), null);
  assert.equal(instrumentInLabel('Semana Santa 2026'), null);
});

const page = (...strs: string[]): PageText => ({ width: 595, height: 842, items: strs.map((str, i) => ({ str, x: 10, y: 10 + i * 20, size: 10 })) });

test('libreto: gana el rótulo que más se repite; si no hay, el nombre del archivo', () => {
  const pages = [
    page('¡A esta es!', 'Corneta 3ª', 'Banda Cornetas y Tambores GITANOS (MALAGA)'),
    page('Al cielo el Rey de Triana', 'Corneta 3ª'),
    page('Bulerías en San Román', 'Corneta 3', 'Banda CC y TT Gitanos (Málaga)'),
    page('Cachorro'),
  ];
  assert.deepEqual(detectInstrument(pages), { instrument: 'Corneta', voice: 3 });
  assert.deepEqual(detectInstrument([page('Cachorro'), page('Macarena')], 'Trompeta 2.pdf'), { instrument: 'Trompeta', voice: 2 });
  assert.equal(detectInstrument([page('Cachorro')], 'libreto.pdf'), null);
});
