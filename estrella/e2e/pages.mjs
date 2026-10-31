// Recorre todas las pantallas con cada rol y detecta errores de ejecución.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE || 'http://localhost:5173';
const OUT = process.env.OUT || 'test-results/pages';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
let bad = 0;
for (const [email, vp, tag] of [['emilio@estrella.demo', { width: 1280, height: 860 }, 'director'], ['componente.c@estrella.demo', { width: 1024, height: 800 }, 'responsable'], ['componente.a@estrella.demo', { width: 390, height: 844 }, 'componente']]) {
  const ctx = await b.newContext({ viewport: vp });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errs.push(`HTTP ${r.status()} ${r.url()}`); });
  await p.goto(`${BASE}/login`);
  await p.fill('input[name=usuario]', email); await p.fill('input[type=password]', 'Estrella2026demo');
  await p.click('button:has-text("Entrar")'); await p.waitForURL((u) => !u.pathname.startsWith('/login'));
  const api = (path) => p.evaluate(async (path) => (await fetch('/api' + path)).json(), path);
  const marcha = (await api('/library/marchas?q=demostraci')).find((m) => m.title.includes('(ESTRELLA)'));
  const det = await api(`/library/marchas/${marcha.id}`);
  const ev = (await api('/events')).find((e) => e.title === 'Ensayo (demo)');
  const course = (await api('/academy/courses'))[0];
  const lessons = (await api(`/academy/courses/${course.id}`)).lessons;
  const members = await api('/members');
  const routes = ['/', '/calendario', `/eventos/${ev.id}`, '/biblioteca', '/biblioteca/importar', `/marchas/${marcha.id}`, `/tocar/${marcha.id}`, '/en-directo', '/dirigir', `/partitura/${det.parts[0].id}`, `/score/${det.scores[0].id}`,
    '/directo', '/dudas', '/avisos', '/academia', `/academia/curso/${course.id}`, `/academia/leccion/${lessons[3].id}`, '/academia/entrenamiento', '/academia/herramientas',
    '/asistente', '/componentes', `/componentes/${members[0].id}`, '/componentes/importar', '/estadisticas', '/inventario', '/admin', '/ajustes', '/direccion'];
  for (const r of routes) {
    const before = errs.length;
    await p.goto(`${BASE}${r}`);
    await p.waitForTimeout(900);
    const name = `${tag}${r.replace(/[\/]/g, '_').replace(/[0-9a-f-]{36}/g, 'id')}`;
    await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
    if (errs.length > before) { bad++; console.log(`✘ ${tag} ${r}: ${errs.slice(before).join(' | ')}`); }
  }
  // asistente (modo verificable): pregunta con datos
  await p.goto(`${BASE}/asistente`);
  await p.selectOption('[data-testid=assistant-marcha]', marcha.id);
  if (tag === 'director') { await p.waitForTimeout(500); await p.locator('select').nth(1).selectOption({ index: 1 }); }
  await p.click('text=¿Qué notas aparecen en los compases 13 a 16?');
  await p.waitForSelector('text=Compás 13', { timeout: 8000 }).catch(() => { bad++; console.log(`✘ ${tag} asistente sin respuesta verificable`); });
  console.log(`${tag}: ${routes.length} pantallas revisadas`);
  await ctx.close();
}
await b.close();
process.exit(bad ? 1 : 0);
