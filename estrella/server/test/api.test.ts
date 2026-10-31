// Pruebas de la API contra una base de datos de pruebas (estrella_test).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://estrella:estrella_dev@localhost:5432/estrella_test';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'estrella-test-'));

const { pool } = await import('../src/db.ts');
const { migrate } = await import('../src/migrate.ts');
const { seedDemo, DEMO_PASSWORD } = await import('../src/seed.ts');
const { createApp } = await import('../src/app.ts');

let base = '';
let server: any;
before(async () => {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(false);
  await seedDemo();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(async () => { server.close(); await pool.end(); });

async function login(email: string) {
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-estrella': '1' }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie')!.split(';')[0];
  return async (p: string, method = 'GET', body?: unknown) => {
    const res = await fetch(`${base}${p}`, { method, headers: { cookie, 'x-estrella': '1', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
  };
}

test('sin sesión no hay acceso; sin cabecera anti-CSRF no hay mutaciones', async () => {
  assert.equal((await fetch(`${base}/library/marchas`)).status, 401);
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('se puede entrar con el teléfono de la ficha, escrito de cualquier forma', async () => {
  await pool.query(`update users set phone = '+34 600 11 22 33' where email = 'componente.b@estrella.demo'`);
  const try_ = (u: string) => fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-estrella': '1' }, body: JSON.stringify({ email: u, password: DEMO_PASSWORD }) }).then((r) => r.status);
  for (const u of ['600112233', '+34600112233', '0034 600-11-22-33', '600 11 22 33']) assert.equal(await try_(u), 200, u);
  assert.equal(await try_('600112234'), 401);
  assert.equal(await try_('12345'), 401);
  await pool.query(`update users set phone = null where email = 'componente.b@estrella.demo'`);
});

test('asignación automática: cada componente recibe su parte y nunca otra voz', async () => {
  const a = await login('componente.a@estrella.demo');
  const b = await login('componente.b@estrella.demo');
  const f = await login('componente.f@estrella.demo'); // corneta 2ª: no hay parte
  const m = (await a('/library/marchas?q=demostraci')).data.find((x: any) => x.title.includes('(ESTRELLA)'));
  const ra = (await a(`/library/marchas/${m.id}/my-part`)).data;
  const rb = (await b(`/library/marchas/${m.id}/my-part`)).data;
  const rf = (await f(`/library/marchas/${m.id}/my-part`)).data;
  assert.equal(ra.part.label, 'Corneta 3ª voz');
  assert.equal(rb.part.label, 'Trompeta');
  assert.equal(rf.status, 'falta_parte');
  assert.equal(rf.part, null);
  assert.match(rf.message, /2ª voz/);
});

test('cambio de asignación registrado y aplicado; un componente no puede hacerlo', async () => {
  const e = await login('emilio@estrella.demo');
  const a = await login('componente.a@estrella.demo');
  const members = (await e('/members')).data;
  const f = members.find((x: any) => x.name.startsWith('Componente F'));
  const struct = (await e('/org/structure')).data;
  const corneta = struct.find((s: any) => s.name === 'Cornetas').instruments[0];
  const v3 = corneta.voices.find((v: any) => v.name === '3ª voz');
  assert.equal((await a(`/members/${f.id}/assignments`, 'POST', { assignments: [{ instrument_id: corneta.id, voice_id: v3.id }] })).status, 403);
  const pend = await e(`/members/${f.id}/assignments`, 'POST', { assignments: [{ instrument_id: corneta.id, voice_id: v3.id }], apply: 'confirmar', reason: 'prueba' });
  assert.equal(pend.status, 200);
  let detail = (await e(`/members/${f.id}`)).data;
  assert.equal(detail.assignments[0].voice, '2ª voz'); // aún no aplicado
  await e(`/members/assignment-changes/${pend.data.change_id}/apply`, 'POST', {});
  detail = (await e(`/members/${f.id}`)).data;
  assert.equal(detail.assignments[0].voice, '3ª voz');
  assert.ok(detail.assignment_changes.some((c: any) => c.status === 'aplicado' && c.reason === 'prueba'));
});

test('importación CSV: previsualización, rechazo de rol de dirección e invitaciones', async () => {
  const e = await login('emilio@estrella.demo');
  const csv = 'nombre;correo;seccion;instrumento;voz;rol\nNueva Persona;nueva@example.com;Cornetas;Corneta;1ª voz;componente\nIntruso;intruso@example.com;Cornetas;Corneta;1ª voz;director\n';
  const send = async (modo: string) => {
    const fd = new FormData();
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'c.csv'); fd.append('modo', modo);
    const login2 = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-estrella': '1' }, body: JSON.stringify({ email: 'emilio@estrella.demo', password: DEMO_PASSWORD }) });
    const cookie = login2.headers.get('set-cookie')!.split(';')[0];
    const r = await fetch(`${base}/members/import`, { method: 'POST', headers: { cookie, 'x-estrella': '1' }, body: fd });
    return { status: r.status, data: await r.json() };
  };
  const prev = await send('previsualizar');
  assert.equal(prev.status, 200);
  assert.equal(prev.data.summary.errores, 1);
  assert.match(prev.data.rows[1].errors.join(), /dirección/);
  assert.equal((await send('importar')).status, 400); // no se importa con errores
  void e;
});

test('anotaciones: capa oficial protegida, privacidad y control de versiones', async () => {
  const e = await login('emilio@estrella.demo');
  const a = await login('componente.a@estrella.demo');
  const b = await login('componente.b@estrella.demo');
  const m = (await e('/library/marchas?q=demostraci')).data.find((x: any) => x.title.includes('(ESTRELLA)'));
  const part = (await e(`/library/marchas/${m.id}`)).data.parts.find((p: any) => p.label === 'Corneta 3ª voz');
  const ann = (layer: string) => ({ id: crypto.randomUUID(), marcha_id: m.id, part_id: part.id, page: 1, layer, kind: 'rect', data: { x: .1, y: .1, w: .2, h: .1 }, color: '#dc2626' });
  assert.equal((await a('/annotations', 'POST', ann('official'))).status, 403);
  const off = await e('/annotations', 'POST', ann('official'));
  assert.equal(off.status, 200);
  const priv = await a('/annotations', 'POST', ann('personal'));
  const listB = (await b(`/annotations?marcha=${m.id}&part=${part.id}`)).data.annotations;
  assert.ok(listB.some((x: any) => x.id === off.data.id));
  assert.ok(!listB.some((x: any) => x.id === priv.data.id));
  // conflicto: dos ediciones con la misma versión
  const u1 = await e(`/annotations/${off.data.id}`, 'PUT', { version: 1, color: '#2563eb' });
  assert.equal(u1.status, 200);
  const u2 = await e(`/annotations/${off.data.id}`, 'PUT', { version: 1, color: '#16a34a' });
  assert.equal(u2.status, 409);
  assert.equal(u2.data.current.color, '#2563eb');
});

test('partituras editables: solo la dirección publica y cada versión queda registrada', async () => {
  const e = await login('emilio@estrella.demo');
  const a = await login('componente.a@estrella.demo');
  const m = (await e('/library/marchas?q=demostraci')).data.find((x: any) => x.title.includes('(ESTRELLA)'));
  const sc = (await e(`/library/marchas/${m.id}`)).data.scores[0];
  const full = (await e(`/scores/${sc.id}`)).data;
  const doc = structuredClone(full.draft);
  doc.measures[0].notes[0].step = doc.measures[0].notes[0].step === 'A' ? 'B' : 'A';
  assert.equal((await a(`/scores/${sc.id}/draft`, 'PUT', { content: doc, rev: full.draft_rev })).status, 403);
  const d1 = await e(`/scores/${sc.id}/draft`, 'PUT', { content: doc, rev: full.draft_rev });
  assert.equal(d1.status, 200);
  assert.equal((await e(`/scores/${sc.id}/draft`, 'PUT', { content: doc, rev: full.draft_rev })).status, 409); // no se sobrescribe en silencio
  const pub = await e(`/scores/${sc.id}/publish`, 'POST', { description: 'Corrección de prueba' });
  assert.equal(pub.status, 200);
  assert.equal(pub.data.number, 2);
  assert.equal(pub.data.changes[0].measure, 1);
  const seen = (await a(`/scores/${sc.id}`)).data;
  assert.equal(seen.version_number, 2);
  assert.equal(seen.draft, undefined); // los músicos no ven borradores
  const rest = await e(`/scores/${sc.id}/restore`, 'POST', { version_id: seen.versions[1].id });
  assert.equal(rest.data.number, 3);
});

test('asistencia: el registro oficial solo lo modifica la dirección o responsables de su sección', async () => {
  const e = await login('emilio@estrella.demo');
  const c = await login('componente.c@estrella.demo'); // responsable de cornetas
  const ev = (await e('/events')).data.find((x: any) => x.title === 'Ensayo (demo)');
  const roster = (await e(`/events/${ev.id}`)).data.roster;
  const a = roster.find((r: any) => r.name.startsWith('Componente A'));
  const b = roster.find((r: any) => r.name.startsWith('Componente B'));
  assert.equal((await c(`/events/${ev.id}/attendance`, 'PUT', [{ user_id: a.id, status: 'presente' }])).status, 200);
  assert.equal((await c(`/events/${ev.id}/attendance`, 'PUT', [{ user_id: b.id, status: 'presente' }])).status, 403); // trompeta: otra sección
  const log = (await e(`/events/${ev.id}/attendance/log`)).data;
  assert.ok(log.some((l: any) => l.user_id === a.id && l.new_status === 'presente'));
});

test('sesión en directo: versión, orden de compás y recuperación del estado', async () => {
  const e = await login('emilio@estrella.demo');
  const b = await login('componente.b@estrella.demo');
  const m = (await e('/library/marchas?q=demostraci')).data.find((x: any) => x.title.includes('(ESTRELLA)'));
  const s = (await e('/live', 'POST', {})).data;
  await e(`/live/${s.id}/cmd`, 'POST', { type: 'select_marcha', marchaId: m.id });
  const r = (await e(`/live/${s.id}/cmd`, 'POST', { type: 'measure', measure: 12 })).data;
  assert.equal(r.version, 3);
  const st = (await b(`/live/${s.id}`)).data; // un dispositivo que se reconecta recupera todo
  assert.equal(st.state.measure, 12);
  assert.equal(st.state.marchaTitle, m.title);
  const mine = (await b(`/live/${s.id}/my-part`)).data;
  assert.equal(mine.part.label, 'Trompeta');
  assert.equal((await b(`/live/${s.id}/cmd`, 'POST', { type: 'stop' })).status, 403);
  await e(`/live/${s.id}/end`, 'POST', {});
});

test('archivos privados: validación por contenido y acceso restringido', async () => {
  const { sniff } = await import('../src/lib/files.ts');
  assert.equal(sniff(Buffer.from('%PDF-1.4 ...'))?.kind, 'pdf');
  assert.equal(sniff(Buffer.from('<html>hola</html>')), null);
  assert.equal(sniff(Buffer.from('MZ\x90\x00')), null); // ejecutable: rechazado
});

test('libreto: cada marcha se separa en su PDF y llega a la voz correcta', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  for (let i = 0; i < 4; i++) doc.addPage([842, 595]);
  const pdf = Buffer.from(await doc.save());
  const e = await login('emilio@estrella.demo');
  const a = await login('componente.a@estrella.demo'); // corneta 3ª
  const b = await login('componente.b@estrella.demo'); // trompeta
  const corneta = (await e('/org/structure')).data.flatMap((s: any) => s.instruments).find((i: any) => i.name === 'Corneta');
  const c3 = corneta.voices.find((v: any) => v.name.startsWith('3'));
  const cookie = async (email: string) => (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-estrella': '1' }, body: JSON.stringify({ email, password: DEMO_PASSWORD }) })).headers.get('set-cookie')!.split(';')[0];
  const send = async (email: string, entries: unknown) => {
    const fd = new FormData();
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'libreto.pdf');
    fd.append('label', 'Corneta 3ª');
    fd.append('instrument_id', String(corneta.id));
    fd.append('voice_id', String(c3.id));
    fd.append('page_count', '4');
    fd.append('entries', JSON.stringify(entries));
    const r = await fetch(`${base}/library/import-book`, { method: 'POST', headers: { cookie: await cookie(email), 'x-estrella': '1' }, body: fd });
    return { status: r.status, data: await r.json() };
  };
  const entries = [{ title: 'Marcha Libreto Uno', composer: 'Autor Uno', from: 1, to: 1 }, { title: 'Marcha Libreto Dos', composer: '', from: 2, to: 3 }];
  assert.equal((await send('componente.a@estrella.demo', entries)).status, 403);
  assert.equal((await send('emilio@estrella.demo', [{ title: 'X', from: 1, to: 2 }, { title: 'Y', from: 2, to: 2 }])).status, 400); // solapadas
  assert.equal((await send('emilio@estrella.demo', [{ title: 'X', from: 4, to: 5 }])).status, 400); // fuera del PDF
  const r1 = await send('emilio@estrella.demo', entries);
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.data.results.map((r: any) => r.status), ['creada', 'creada']);
  const dos = r1.data.results[1].marcha_id;
  const ra = (await a(`/library/marchas/${dos}/my-part`)).data;
  assert.equal(ra.status, 'ok');
  assert.equal(ra.part.page_count, 2);
  assert.deepEqual([ra.part.page_from, ra.part.page_to], [2, 3]);
  assert.equal((await b(`/library/marchas/${dos}/my-part`)).data.status, 'falta_parte');
  // el libreto se guarda una vez, sin modificar, y todas sus marchas lo comparten
  const uno = (await a(`/library/marchas/${r1.data.results[0].marcha_id}/my-part`)).data.part;
  assert.equal(uno.file_id, ra.part.file_id);
  const file = await fetch(`${base}/files/${ra.part.file_id}`, { headers: { cookie: await cookie('componente.a@estrella.demo') } });
  assert.equal((await PDFDocument.load(Buffer.from(await file.arrayBuffer()))).getPageCount(), 4);
  // reimportar con otro formato de título: misma marcha, nueva versión de la parte
  const r2 = await send('emilio@estrella.demo', [{ title: 'marcha libreto dós', from: 4, to: 4 }]);
  assert.equal(r2.data.results[0].marcha_id, dos);
  assert.equal(r2.data.results[0].status, 'nueva_version');
  const again = (await a(`/library/marchas/${dos}/my-part`)).data.part;
  assert.equal(again.version, 2);
  assert.equal(again.page_count, 1);
  assert.equal((await e(`/library/marchas/${r1.data.results[0].marcha_id}`)).data.composer, 'Autor Uno');
});

test('notas leídas del PDF: se publican para la voz, se marcan los compases dudosos y no pisan una partitura hecha a mano', async () => {
  const e = await login('emilio@estrella.demo');
  const a = await login('componente.a@estrella.demo'); // corneta 3ª
  const m = (await e('/library/marchas?q=libreto dos')).data[0];
  const pending = (await e('/scores/pdf/pending')).data;
  const row = pending.find((r: any) => r.marcha_id === m.id);
  assert.ok(row, 'la parte del libreto está pendiente de notas');
  assert.equal(row.transposition, -2);
  const content = { schema: 1, title: 'x', clef: 'treble', key: 3, time: [4, 4], tempo: 76, transposition: -2, measures: [
    { id: 'm1', n: 1, notes: [{ id: 'n1', step: 'C', octave: 5, alter: 1, dur: 'h', dots: 1 }, { id: 'n2', rest: true, dur: 'q' }] },
    { id: 'm2', n: 2, notes: [{ id: 'n3', step: 'D', octave: 5, dur: '8', triplet: true }, { id: 'n4', step: 'D', octave: 5, dur: '8', triplet: true }, { id: 'n5', step: 'D', octave: 5, dur: '8', triplet: true }] },
  ] };
  assert.equal((await a(`/scores/pdf/${row.part_id}`, 'POST', { content, review: [2] })).status, 403);
  const r = await e(`/scores/pdf/${row.part_id}`, 'POST', { content, review: [2] });
  assert.equal(r.status, 200);
  const mine = (await a(`/library/marchas/${m.id}/my-part`)).data;
  assert.equal(mine.score.id, r.data.score_id);
  const sc = (await a(`/scores/${r.data.score_id}`)).data;
  assert.equal(sc.source, 'pdf');
  assert.deepEqual(sc.review_measures, [2]);
  assert.equal(sc.published.title, m.title);
  assert.ok(!(await e('/scores/pdf/pending')).data.some((x: any) => x.part_id === row.part_id));
  // una partitura editable hecha por la dirección nunca se sustituye
  const t = (await e('/library/marchas?q=libreto uno')).data[0];
  const prow = (await e('/scores/pdf/pending')).data.find((x: any) => x.marcha_id === t.id);
  const manual = await e('/scores', 'POST', { marcha_id: t.id, label: 'Corneta 3ª', instrument_id: prow.instrument_id, voice_id: prow.voice_id, source: 'manual', content });
  assert.equal(manual.status, 200);
  assert.equal((await e(`/scores/pdf/${prow.part_id}`, 'POST', { content, review: [] })).status, 409);
});
