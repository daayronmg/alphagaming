// Pruebas de extremo a extremo con varias sesiones simultáneas (Playwright).
// Requisitos: servidor (API) y web en marcha, base de datos sembrada con `npm run seed -- --reset`.
// Uso: BASE=http://localhost:5173 node e2e/run.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = process.env.OUT || 'test-results';
const PW = process.env.DEMO_PASSWORD || 'Estrella2026demo';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let failed = 0;
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push(`✔ ${name} (${Date.now() - t0} ms)`); console.log(`✔ ${name}`); }
  catch (e) { failed++; results.push(`✘ ${name}: ${e.message}`); console.log(`✘ ${name}\n   ${e.message}`); }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };

const browser = await chromium.launch();
const errors = [];
async function session(email, viewport, label) {
  const ctx = await browser.newContext({ viewport, hasTouch: viewport.width < 800 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', PW);
  await page.click('button:has-text("Entrar")');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 10000 });
  // llamadas a la API con la sesión del propio usuario
  const api = async (path, method = 'GET', body) => page.evaluate(async ({ path, method, body }) => {
    const r = await fetch(`/api${path}`, { method, headers: { 'x-estrella': '1', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  }, { path, method, body });
  return { ctx, page, api, label };
}
const shot = (s, name) => s.page.screenshot({ path: `${OUT}/${name}.png` });

// ===== Sesiones =====
const emilio = await session('emilio@estrella.demo', { width: 1280, height: 860 }, 'Emilio (tableta)');
const A = await session('componente.a@estrella.demo', { width: 412, height: 900 }, 'A · corneta 3ª');
const B = await session('componente.b@estrella.demo', { width: 412, height: 900 }, 'B · trompeta');

// datos de referencia (lo que DEBE recibir cada uno)
const marchas = (await emilio.api('/library/marchas?q=demostraci')).data;
const marcha = marchas.find((m) => m.title.includes('(ESTRELLA)'));
const detail = (await emilio.api(`/library/marchas/${marcha.id}`)).data;
const partC3 = detail.parts.find((p) => p.label === 'Corneta 3ª voz');
const partTp = detail.parts.find((p) => p.label === 'Trompeta');
const scoreC3 = detail.scores.find((s) => s.label === 'Corneta 3ª voz');
const events = (await emilio.api('/events')).data;
const ensayo = events.find((e) => e.title === 'Ensayo (demo)');
// cierra sesiones en directo previas
for (const l of (await emilio.api('/live/active')).data) await emilio.api(`/live/${l.id}/end`, 'POST', {});

let sessionId;
await test('Componentes esperan en «Ensayo en directo» sin sesión activa', async () => {
  for (const s of [A, B]) { await s.page.goto(`${BASE}/directo`); await s.page.getByText('No hay ningún ensayo en directo').waitFor({ timeout: 8000 }); }
});

await test('Emilio inicia el ensayo desde la tableta y los componentes se unen solos', async () => {
  await emilio.page.goto(`${BASE}/direccion`);
  await emilio.page.click(`[data-testid="start-live-${ensayo.id}"]`);
  await emilio.page.waitForURL(/\/direccion\/[0-9a-f-]{36}/);
  sessionId = emilio.page.url().split('/').pop();
  for (const s of [A, B]) await s.page.waitForURL(new RegExp(`/directo/${sessionId}`), { timeout: 10000 });
  for (const s of [A, B]) await s.page.getByText('Conectado al ensayo').waitFor({ timeout: 10000 });
});

await test('Emilio selecciona la marcha y pulsa «Enviar al ensayo»', async () => {
  await emilio.page.click('[data-testid=pick-marcha]');
  await emilio.page.click('[data-testid=pick-option] >> nth=0');
  await emilio.page.locator('[data-testid=console-marcha]').filter({ hasText: 'Marcha de demostración' }).waitFor({ timeout: 8000 });
});

await test('Usuario A (corneta 3ª) recibe automáticamente SU partitura de corneta 3ª', async () => {
  const ws = A.page.locator('[data-testid=part-workspace]');
  await ws.waitFor({ timeout: 10000 });
  assert(await ws.getAttribute('data-part-id') === partC3.id, `parte recibida ${await ws.getAttribute('data-part-id')} ≠ corneta 3ª`);
  assert(await ws.getAttribute('data-file-id') === partC3.file_id, 'archivo distinto al de corneta 3ª');
  await A.page.locator('[data-testid=live-part-label]').filter({ hasText: 'Corneta 3ª voz' }).waitFor();
  await A.page.locator('.score-page canvas').first().waitFor();
  await shot(A, 'A-recibe-corneta3');
});

await test('Usuario B (trompeta) recibe automáticamente SU partitura de trompeta', async () => {
  const ws = B.page.locator('[data-testid=part-workspace]');
  await ws.waitFor({ timeout: 10000 });
  assert(await ws.getAttribute('data-part-id') === partTp.id, 'B no ha recibido la parte de trompeta');
  assert(await ws.getAttribute('data-file-id') === partTp.file_id, 'archivo distinto al de trompeta');
  assert(partTp.file_id !== partC3.file_id, 'las dos partes deberían ser archivos distintos');
  await B.page.locator('[data-testid=live-part-label]').filter({ hasText: 'Trompeta' }).waitFor();
  await shot(B, 'B-recibe-trompeta');
});

await test('Emilio marca el compás 16: cada músico va al compás 16 de SU parte (páginas distintas)', async () => {
  await emilio.page.fill('[data-testid=jump-input]', '16');
  await emilio.page.click('[data-testid=jump-go]');
  for (const s of [A, B]) await s.page.locator('[data-testid=live-measure]').filter({ hasText: /^16$/ }).waitFor({ timeout: 8000 });
  // corneta 3ª: 16 compases por página → c.16 en la pág. 1; trompeta: 15 por página → c.16 en la pág. 2
  const pageOf = (s) => s.page.locator('[data-testid=measure-highlight]').first().evaluate((el) => el.closest('[data-page]').getAttribute('data-page'));
  assert(await pageOf(A) === '1', 'A debería ver el c.16 en la página 1');
  assert(await pageOf(B) === '2', 'B debería ver el c.16 en la página 2');
  await shot(B, 'B-compas16-pagina2');
});

await test('Prueba A: Emilio dibuja en el PDF y el componente lo ve sin recargar', async () => {
  // Emilio abre en la consola la misma parte (corneta 3ª) y dibuja en la capa oficial
  await emilio.page.selectOption('select:near(:text("Partitura en la tableta:"))', partC3.id).catch(() => {});
  const ws = emilio.page.locator(`[data-testid=part-workspace][data-part-id="${partC3.id}"]`);
  await ws.waitFor({ timeout: 8000 });
  await ws.locator('[data-testid=layer-select]').selectOption('official');
  await ws.locator('[data-tool=pen]').click();
  const before = await A.page.locator('.score-page svg.layer path').count();
  await ws.locator('.score-scroll').scrollIntoViewIfNeeded();
  await emilio.page.waitForTimeout(400);
  const sc = await ws.locator('.score-scroll').boundingBox();
  const sv = await ws.locator('.score-page svg.layer').first().boundingBox();
  // punto visible dentro del área de la partitura
  const x0 = Math.max(sc.x, sv.x) + 60, y0 = Math.max(sc.y, sv.y) + 60;
  await emilio.page.mouse.move(x0, y0);
  await emilio.page.mouse.down();
  for (let i = 1; i <= 12; i++) await emilio.page.mouse.move(x0 + i * 12, y0 + (i % 2) * 6);
  await emilio.page.mouse.up();
  await emilio.page.waitForTimeout(500);
  const offs = (await emilio.api(`/annotations?marcha=${marcha.id}&part=${partC3.id}`)).data.annotations.filter((a) => a.kind === 'pen' && a.layer === 'official');
  assert(offs.length > 0, 'el trazo del director no se ha guardado');
  await A.page.waitForFunction((n) => document.querySelectorAll('.score-page svg.layer path').length > n, before, { timeout: 8000 });
  await shot(A, 'A-ve-dibujo-director');
});

await test('Anotación de compás del director: A y B la reciben sobre sus respectivas partituras', async () => {
  const r = await emilio.api('/annotations', 'POST', { id: crypto.randomUUID(), marcha_id: marcha.id, part_id: null, page: null, layer: 'official', kind: 'measure', data: { text: 'Entramos todos juntos después del silencio' }, color: '#dc2626', measure: 16, audience: { scope: 'all' } });
  assert(r.status === 200, `crear anotación: ${r.status}`);
  for (const s of [A, B]) await s.page.locator('.score-page svg text').filter({ hasText: 'Entramos todos juntos' }).first().waitFor({ timeout: 8000 });
  // y aparece en la página donde está el c.16 de cada parte
  const pageOfText = (s) => s.page.locator('.score-page svg text').filter({ hasText: 'Entramos todos juntos' }).first().evaluate((el) => el.closest('[data-page]').getAttribute('data-page'));
  assert(await pageOfText(A) === '1' && await pageOfText(B) === '2', 'la indicación no está en el compás equivalente de cada parte');
  await shot(B, 'B-recibe-indicacion');
});

await test('Mensaje del director solo a cornetas: A lo ve, B (trompeta) no', async () => {
  const struct = (await emilio.api('/org/structure')).data;
  const cornetas = struct.find((s) => s.name === 'Cornetas');
  await emilio.api(`/live/${sessionId}/cmd`, 'POST', { type: 'message', text: 'Solo cornetas: atención a la entrada', audience: { scope: 'sections', sections: [cornetas.id] } });
  await A.page.locator('[data-testid=director-message]').filter({ hasText: 'Solo cornetas' }).waitFor({ timeout: 8000 });
  await B.page.waitForTimeout(800);
  assert(!(await B.page.locator('[data-testid=director-message]').filter({ hasText: 'Solo cornetas' }).count()), 'B no debería ver el mensaje de cornetas');
});

await test('Iniciar/detener: arranque programado y estado compartido', async () => {
  await emilio.page.click('[data-testid=cmd-play]');
  for (const s of [A, B]) await s.page.locator('[data-testid=live-transport]').filter({ hasText: /Entrada en|Sonando/ }).waitFor({ timeout: 6000 });
  await emilio.page.click('[data-testid=cmd-stop]');
  for (const s of [A, B]) await s.page.locator('[data-testid=live-transport]').filter({ hasText: 'Detenido' }).waitFor({ timeout: 6000 });
});

await test('Prueba F: B pierde la conexión, el director cambia el compás y B se recupera al reconectar', async () => {
  await B.ctx.setOffline(true);
  await B.page.locator('[data-testid=live-sync][data-state=desconectado]').waitFor({ timeout: 15000 }).catch(() => {});
  await emilio.api(`/live/${sessionId}/cmd`, 'POST', { type: 'measure', measure: 21 });
  await B.page.waitForTimeout(500);
  await B.ctx.setOffline(false);
  await B.page.locator('[data-testid=live-measure]').filter({ hasText: /^21$/ }).waitFor({ timeout: 20000 });
  await B.page.locator('[data-testid=live-sync][data-state=conectado]').waitFor({ timeout: 15000 });
  // la presencia de B vuelve a «sincronizado» en la consola
  await emilio.page.locator('[data-testid=presence-row][data-name="Componente B (demo)"][data-status=sincronizado]').first().waitFor({ timeout: 10000 });
  await shot(emilio, 'consola-director');
});

await test('Prueba E: un componente no puede dirigir, publicar partituras oficiales ni cambiar asignaciones', async () => {
  const me = (await B.api('/auth/me')).data.user;
  const r1 = await A.api(`/members/${me.id}/assignments`, 'POST', { assignments: [{ instrument_id: 1, voice_id: null }] });
  assert(r1.status === 403, `cambio de asignación ajena: ${r1.status}`);
  const r2 = await A.api(`/scores/${scoreC3.id}/publish`, 'POST', { description: 'intento' });
  assert(r2.status === 403, `publicar: ${r2.status}`);
  const r3 = await A.api(`/scores/${scoreC3.id}/draft`, 'PUT', { content: {}, rev: 0 });
  assert(r3.status === 403, `borrador: ${r3.status}`);
  const r4 = await A.api(`/live/${sessionId}/cmd`, 'POST', { type: 'measure', measure: 2 });
  assert(r4.status === 403, `orden de dirección: ${r4.status}`);
  const r5 = await A.api('/annotations', 'POST', { id: crypto.randomUUID(), marcha_id: marcha.id, part_id: partC3.id, page: 1, layer: 'official', kind: 'pen', data: { points: [[0.1, 0.1], [0.2, 0.2]] }, color: '#000000' });
  assert(r5.status === 403, `capa oficial: ${r5.status}`);
  const r6 = await A.api(`/library/parts/${partC3.id}/measures`, 'PUT', []);
  assert(r6.status === 403, `mapa de compases: ${r6.status}`);
  const r7 = await A.api(`/events/${ensayo.id}/attendance`, 'PUT', [{ user_id: me.id, status: 'presente' }]);
  assert(r7.status === 403, `asistencia oficial: ${r7.status}`);
  // y la asignación de B sigue intacta
  const resB = (await B.api(`/library/marchas/${marcha.id}/my-part`)).data;
  assert(resB.part.id === partTp.id, 'la asignación de B ha cambiado');
});

await test('Prueba G: una anotación personal es privada', async () => {
  const id = crypto.randomUUID();
  const r = await A.api('/annotations', 'POST', { id, marcha_id: marcha.id, part_id: partC3.id, page: 1, layer: 'personal', kind: 'text', data: { x: 0.5, y: 0.5, text: 'Mi nota privada' }, color: '#2563eb' });
  assert(r.status === 200, `crear personal: ${r.status}`);
  const seenB = (await B.api(`/annotations?marcha=${marcha.id}&part=${partC3.id}`)).data.annotations.some((a) => a.id === id);
  const seenE = (await emilio.api(`/annotations?marcha=${marcha.id}&part=${partC3.id}`)).data.annotations.some((a) => a.id === id);
  assert(!seenB && !seenE, 'la anotación personal es visible para otros');
  const seenA = (await A.api(`/annotations?marcha=${marcha.id}&part=${partC3.id}`)).data.annotations.some((a) => a.id === id);
  assert(seenA, 'el autor no ve su propia anotación');
  const r2 = await B.api(`/annotations/${id}`, 'PUT', { version: 1, data: { x: 0, y: 0, text: 'hack' } });
  assert(r2.status === 404, `B modificando nota privada de A: ${r2.status}`);
});

let doubtId;
await test('Prueba B: A selecciona un fragmento y envía una duda; Emilio ve exactamente la zona', async () => {
  await A.page.goto(`${BASE}/partitura/${partC3.id}`);
  await A.page.locator('.score-page canvas').first().waitFor();
  await A.page.waitForTimeout(800);
  await A.page.click('[data-testid=ask-doubt]');
  const box = await A.page.locator('.score-page svg.layer').first().boundingBox();
  await A.page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.16);
  await A.page.mouse.down();
  await A.page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.24, { steps: 5 });
  await A.page.mouse.up();
  await A.page.fill('[data-testid=doubt-text]', 'Emilio, ¿esta entrada la hacemos más corta o mantenemos la duración escrita?');
  await A.page.click('[data-testid=doubt-send]');
  await A.page.locator('[data-testid=doubt-thread]').waitFor({ timeout: 8000 });
  const inbox = (await emilio.api('/doubts?scope=inbox')).data;
  const d = inbox.find((x) => x.text.startsWith('Emilio, ¿esta entrada'));
  assert(d, 'la duda no llega a la bandeja');
  doubtId = d.id;
  assert(d.part_id === partC3.id && d.page === 1 && d.instrument === 'Corneta' && d.voice === '3ª voz' && d.author_name === 'Componente A (demo)', 'faltan datos automáticos de la duda');
  assert(Math.abs(d.rect.x - 0.25) < 0.02 && Math.abs(d.rect.y - 0.16) < 0.02, `zona guardada incorrecta ${JSON.stringify(d.rect)}`);
  assert(d.crop_file_id, 'falta la imagen del fragmento');
  await emilio.page.goto(`${BASE}/partitura/${partC3.id}?duda=${doubtId}`);
  await emilio.page.locator('[data-testid=doubt-thread] img').first().waitFor({ timeout: 8000 });
  await emilio.page.locator('.measure-hl').filter({ hasText: 'Fragmento de la duda' }).waitFor();
  await shot(emilio, 'director-abre-duda');
});

await test('Prueba C: Emilio responde y el componente recibe la respuesta vinculada a su pregunta', async () => {
  await emilio.page.locator('[data-testid=doubt-thread] textarea').fill('Mantenemos la duración escrita, pero sin acento.');
  await emilio.page.locator('[data-testid=doubt-thread] button:has-text("Enviar")').click();
  await A.page.locator('[data-testid=doubt-thread]').getByText('Mantenemos la duración escrita').waitFor({ timeout: 8000 });
  const d = (await A.api(`/doubts/${doubtId}`)).data;
  assert(d.status === 'respondida', 'estado no actualizado');
  await shot(A, 'A-recibe-respuesta');
});

await test('Prueba D: Emilio modifica una nota, publica una versión y los músicos la reciben sin recargar', async () => {
  await A.page.goto(`${BASE}/score/${scoreC3.id}`);
  await A.page.locator('[data-testid=score-version]').filter({ hasText: 'Versión 1' }).waitFor({ timeout: 8000 });
  await emilio.page.goto(`${BASE}/score/${scoreC3.id}`);
  await emilio.page.click('[data-testid=edit-score]');
  await emilio.page.locator('[data-testid=staff] svg').waitFor();
  const firstNote = (await emilio.api(`/scores/${scoreC3.id}`)).data.published.measures[0].notes[0].id;
  await emilio.page.locator(`[id="vf-${firstNote}"] .vf-notehead path`).first().click({ force: true });
  await emilio.page.click('[data-testid=note-up]');
  await emilio.page.locator('.badge', { hasText: 'Borrador: guardado' }).waitFor({ timeout: 8000 });
  await emilio.page.waitForTimeout(400);
  await emilio.page.click('[data-testid=publish-score]');
  await emilio.page.fill('[data-testid=publish-description]', 'Corregida la primera nota (prueba)');
  await emilio.page.click('[data-testid=publish-confirm]');
  await A.page.locator('[data-testid=score-version]').filter({ hasText: 'Versión 2' }).waitFor({ timeout: 10000 });
  const v = (await A.api(`/scores/${scoreC3.id}`)).data;
  assert(v.versions[0].number === 2 && v.versions[0].author === 'Emilio García' && v.versions[0].changes.some((c) => c.measure === 1), 'historial de versión incompleto');
  await shot(A, 'A-recibe-version2');
});

await test('Registro de asistencia y resumen del ensayo quedan guardados', async () => {
  const roster = (await emilio.api(`/events/${ensayo.id}`)).data.roster;
  const a = roster.find((r) => r.name.startsWith('Componente A'));
  const b = roster.find((r) => r.name.startsWith('Componente B'));
  const r = await emilio.api(`/events/${ensayo.id}/attendance`, 'PUT', [{ user_id: a.id, status: 'presente' }, { user_id: b.id, status: 'retraso', minutes_late: 5 }]);
  assert(r.status === 200, `asistencia: ${r.status}`);
  await emilio.page.goto(`${BASE}/direccion/${sessionId}`);
  await emilio.page.click('button:has-text("Finalizar")');
  await emilio.page.fill('[data-testid=summary-worked]', 'Marcha de demostración: compases 13–16');
  await emilio.page.click('[data-testid=save-summary]');
  await emilio.page.waitForURL(new RegExp(`/eventos/${ensayo.id}`), { timeout: 8000 });
  const ev = (await emilio.api(`/events/${ensayo.id}`)).data;
  assert(ev.summary?.worked?.includes('13–16') && ev.status === 'finalizado', 'resumen no guardado');
  const attA = (await A.api(`/events/${ensayo.id}`)).data.my.attendance;
  assert(attA?.status === 'presente', 'A no ve su asistencia');
});

console.log('\n' + results.join('\n'));
if (errors.length) console.log('\nErrores de página:\n' + [...new Set(errors)].slice(0, 15).join('\n'));
fs.writeFileSync(`${OUT}/resultados.txt`, results.join('\n') + (errors.length ? '\n\nErrores de página:\n' + [...new Set(errors)].join('\n') : '') + '\n');
await browser.close();
process.exit(failed ? 1 : 0);
