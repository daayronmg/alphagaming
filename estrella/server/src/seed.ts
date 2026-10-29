/**
 * Datos de DEMOSTRACIÓN claramente identificados (is_demo = true, correos @estrella.demo).
 * Uso:  npm run seed            → solo si la base de datos está vacía
 *       npm run seed -- --reset → borra TODO y vuelve a sembrar (¡solo en desarrollo!)
 *       npm run seed -- --academy → solo la academia (para una instalación real)
 *       npm run seed -- --director "Nombre" email@dominio  → crea la cuenta de dirección real
 */
import { pool, q, one, tx } from './db.ts';
import { migrate } from './migrate.ts';
import { hashPassword, randomToken } from './lib/auth.ts';
import { storeFile } from './lib/files.ts';
import { demoPartPdf } from './lib/demoPdf.ts';
import { COURSES } from './academyContent.ts';
import { uid, type ScoreDoc, type Note, type Measure, type Step, type Dur } from '../../shared/music.ts';
import { config } from './config.ts';

process.env.TZ ||= 'Europe/Madrid';
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Estrella2026demo';

function n(spec: string): Note {
  // "G4:q", "C5:8.", "r:q", "Bb4:h", "F#5:q"
  const [p, d] = spec.split(':');
  const dots = d.endsWith('.') ? 1 : 0;
  const dur = d.replace('.', '') as Dur;
  if (p === 'r') return { id: uid(), rest: true, dur, dots };
  const m = p.match(/^([A-G])(#|b)?(\d)$/)!;
  return { id: uid(), step: m[1] as Step, alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave: Number(m[3]), dur, dots };
}
function score(title: string, bars: string[], marks: Record<number, string>, transposition: number): ScoreDoc {
  const measures: Measure[] = bars.map((b, i) => ({ id: uid(), n: i + 1, notes: b.trim().split(/\s+/).map(n), ...(marks[i + 1] ? { mark: marks[i + 1] } : {}) }));
  return { schema: 1, title, clef: 'treble', key: 0, time: [2, 4], tempo: 76, transposition, measures };
}

// Material musical inventado para la demostración (no corresponde a ninguna marcha real)
const MARKS = { 1: 'Intro', 5: 'A', 13: 'B', 21: 'Final' };
const CORNETA_3 = [
  'G4:q G4:q', 'C5:8 C5:8 G4:q', 'E4:q.  G4:8', 'C5:h',
  'G4:8 G4:8 G4:8 A4:8', 'B4:q G4:q', 'C5:8. B4:16 A4:8 G4:8', 'E4:h',
  'G4:q A4:q', 'B4:8 C5:8 D5:q', 'C5:q B4:q', 'G4:h',
  'r:q G4:q', 'C5:q E5:q', 'D5:8 C5:8 B4:8 A4:8', 'G4:h',
  'A4:q C5:q', 'B4:8 A4:8 G4:q', 'E4:8 G4:8 C5:q', 'G4:h',
  'C5:q G4:q', 'E4:q C4:q', 'G4:q. G4:8', 'C5:h',
];
const TROMPETA = [
  'C5:q C5:q', 'E5:8 E5:8 C5:q', 'G4:q. C5:8', 'E5:h',
  'C5:8 D5:8 E5:8 F5:8', 'G5:q E5:q', 'F5:8. E5:16 D5:8 C5:8', 'G4:h',
  'E5:q F5:q', 'G5:8 A5:8 G5:q', 'F5:q D5:q', 'C5:h',
  'r:q E5:q', 'G5:q C6:q', 'B5:8 A5:8 G5:8 F5:8', 'E5:h',
  'F5:q A5:q', 'G5:8 F5:8 E5:q', 'C5:8 E5:8 G5:q', 'E5:h',
  'E5:q C5:q', 'G4:q E4:q', 'C5:q. C5:8', 'C5:h',
];
const CORNETA_1 = CORNETA_3.map((b) => b.replace(/([A-G])(\d)/g, (_, s, o) => `${s}${Number(o)}`).replace(/G4/g, 'B4').replace(/E4/g, 'G4').replace(/C4/g, 'E4'));

async function ensureStructure() {
  const structure: { name: string; family: string; color: string; instruments: { name: string; clef: string; transposition: number; voices: string[] }[] }[] = [
    { name: 'Cornetas', family: 'viento', color: '#d4a017', instruments: [{ name: 'Corneta', clef: 'treble', transposition: -2, voices: ['1ª voz', '2ª voz', '3ª voz'] }] },
    { name: 'Trompetas', family: 'viento', color: '#e0662b', instruments: [{ name: 'Trompeta', clef: 'treble', transposition: -2, voices: [] }] },
    { name: 'Trombones', family: 'viento', color: '#b4483c', instruments: [{ name: 'Trombón', clef: 'bass', transposition: 0, voices: [] }] },
    { name: 'Bombardinos', family: 'viento', color: '#8d5a97', instruments: [{ name: 'Bombardino', clef: 'bass', transposition: 0, voices: [] }] },
    { name: 'Percusión', family: 'percusion', color: '#3f7cac', instruments: [
      { name: 'Caja', clef: 'percussion', transposition: 0, voices: [] },
      { name: 'Bombo', clef: 'percussion', transposition: 0, voices: [] },
      { name: 'Platos', clef: 'percussion', transposition: 0, voices: [] },
    ] },
  ];
  for (const [si, s] of structure.entries()) {
    const sec = await one<any>(`insert into sections(name, family, color, sort) values ($1,$2,$3,$4) on conflict (name) do update set name = excluded.name returning id`, [s.name, s.family, s.color, si]);
    for (const [ii, ins] of s.instruments.entries()) {
      const i = await one<any>(`insert into instruments(section_id, name, clef, transposition, sort) values ($1,$2,$3,$4,$5) on conflict (section_id, name) do update set name = excluded.name returning id`, [sec.id, ins.name, ins.clef, ins.transposition, ii]);
      for (const [vi, v] of ins.voices.entries()) await q(`insert into voices(instrument_id, name, sort) values ($1,$2,$3) on conflict do nothing`, [i.id, v, vi]);
    }
  }
}

const ids = async () => {
  const get = async (inst: string, voice?: string) => {
    const i = await one<any>('select id from instruments where name = $1', [inst]);
    const v = voice ? await one<any>('select id from voices where instrument_id = $1 and name = $2', [i.id, voice]) : null;
    return { instrument_id: i.id as number, voice_id: (v?.id ?? null) as number | null };
  };
  return { c1: await get('Corneta', '1ª voz'), c2: await get('Corneta', '2ª voz'), c3: await get('Corneta', '3ª voz'), tp: await get('Trompeta'), tb: await get('Trombón'), caja: await get('Caja'), bombo: await get('Bombo') };
};

export async function seedAcademy(authorId: string | null) {
  const exists = await one('select 1 from courses limit 1');
  if (exists) return;
  for (const [ci, c] of COURSES.entries()) {
    const sec = c.section ? await one<any>('select id from sections where name = $1', [c.section]) : null;
    const course = await one<any>(`insert into courses(level, title, description, status, sort, section_id, created_by, reviewed_by) values ($1,$2,$3,$4,$5,$6,$7,$7) returning id`,
      [c.level, c.title, c.description, c.status, ci, sec?.id ?? null, authorId]);
    for (const [li, l] of c.lessons.entries()) {
      await q(`insert into lessons(course_id, sort, title, explanation, demo, audio, exercise, quiz, practice, summary, status) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [course.id, li, l.title, l.explanation, l.demo ? JSON.stringify(l.demo) : null, l.audio ? JSON.stringify(l.audio) : null, l.exercise ? JSON.stringify(l.exercise) : null, JSON.stringify(l.quiz), l.practice, l.summary, l.status ?? 'publicado']);
    }
  }
}

export async function seedDemo() {
  await ensureStructure();
  const I = await ids();
  await q(`insert into settings(key, value) values ('branding', $1) on conflict (key) do nothing`, [JSON.stringify({
    appName: config.appName, bandName: 'Banda de Cornetas y Tambores Estrella de Málaga', accent: '#c9a227', instagram: 'https://www.instagram.com/bctestrellamlg/',
  })]);

  const pw = hashPassword(DEMO_PASSWORD);
  const mk = async (name: string, email: string, role: string, assignments: { instrument_id: number; voice_id: number | null }[], perms: string[] = []) => {
    const u = await one<any>(`insert into users(email, password_hash, name, role, status, joined_at, is_demo, permissions) values ($1,$2,$3,$4,'active', current_date - 400, true, $5) returning id`, [email, pw, name, role, perms]);
    for (const [i, a] of assignments.entries()) await q('insert into user_assignments(user_id, instrument_id, voice_id, is_default) values ($1,$2,$3,$4)', [u.id, a.instrument_id, a.voice_id, i === 0]);
    await q(`insert into assignment_changes(user_id, before, after, status, reason, applied_at) values ($1,'[]',$2,'aplicado','Alta (demo)',now())`, [u.id, JSON.stringify(assignments)]);
    return u.id as string;
  };
  // Director musical (nombre facilitado por la banda; correo y contraseña de demostración)
  const emilio = await mk('Emilio García', 'emilio@estrella.demo', 'director', []);
  const a = await mk('Componente A (demo)', 'componente.a@estrella.demo', 'member', [I.c3]);
  const b = await mk('Componente B (demo)', 'componente.b@estrella.demo', 'member', [I.tp]);
  const c = await mk('Componente C (demo)', 'componente.c@estrella.demo', 'leader', [I.c1]);
  const d = await mk('Componente D (demo)', 'componente.d@estrella.demo', 'member', [I.tb]);
  const e = await mk('Componente E (demo)', 'componente.e@estrella.demo', 'member', [I.caja, I.bombo]);
  const f = await mk('Componente F (demo)', 'componente.f@estrella.demo', 'member', [I.c2]);
  const cornetas = await one<any>(`select id from sections where name = 'Cornetas'`);
  await q(`insert into section_leaders(user_id, section_id, permissions) values ($1,$2,'{attendance,members,announce,annotate,doubts,lessons}')`, [c, cornetas.id]);

  // Marcha de demostración con partes distintas por voz
  const folder = await one<any>(`insert into folders(name) values ('Demostración') returning id`);
  const marcha = await one<any>(`insert into marchas(title, composer, year, duration_sec, march_type, instrumentation, measures, director_notes, difficulty, folder_id, last_reviewed_at, is_demo, created_by)
    values ('Marcha de demostración (ESTRELLA)', 'Material de prueba (no es una obra real)', null, 75, 'Procesional', 'Cornetas (1ª, 3ª), trompeta', 24,
      'DEMO · Atención a la entrada del compás 13 después del silencio. No acelerar en el final.', 2, $1, current_date, true, $2) returning id`, [folder.id, emilio]);
  await q(`insert into tags(name) values ('Demostración'), ('Cuaresma') on conflict do nothing`);
  await q(`insert into marcha_tags select $1, id from tags where name in ('Demostración')`, [marcha.id]);
  await q(`insert into marcha_changes(marcha_id, user_id, summary) values ($1,$2,'Marcha de demostración creada')`, [marcha.id, emilio]);

  const partDefs = [
    { label: 'Corneta 3ª voz', ids: I.c3, bars: CORNETA_3, mps: 4, sys: 4, transposition: -2 },
    { label: 'Trompeta', ids: I.tp, bars: TROMPETA, mps: 3, sys: 5, transposition: -2 },
    { label: 'Corneta 1ª voz', ids: I.c1, bars: CORNETA_1, mps: 4, sys: 4, transposition: -2 },
  ];
  for (const p of partDefs) {
    const doc = score(`Marcha de demostración — ${p.label}`, p.bars, MARKS, p.transposition);
    const { pdf, layout } = demoPartPdf('Marcha de demostración (ESTRELLA)', p.label, doc, p.mps, p.sys);
    const file = await storeFile(pdf, `demo-${p.label.replace(/\s+/g, '-').toLowerCase()}.pdf`, emilio, ['pdf']);
    const part = await one<any>(`insert into parts(marcha_id, instrument_id, voice_id, label, file_id, page_count, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [marcha.id, p.ids.instrument_id, p.ids.voice_id, p.label, file.id, Math.max(...layout.map((l) => l.page)), emilio]);
    for (const l of layout) await q('insert into part_measures values ($1,$2,$3,$4,$5,$6,$7)', [part.id, l.measure, l.page, l.x, l.y, l.w, l.h]);
    // versión editable publicada (modo B)
    const s = await one<any>(`insert into scores(marcha_id, instrument_id, voice_id, part_id, label, source, draft, draft_updated_by, draft_updated_at) values ($1,$2,$3,$4,$5,'manual',$6,$7,now()) returning id`,
      [marcha.id, p.ids.instrument_id, p.ids.voice_id, part.id, p.label, JSON.stringify(doc), emilio]);
    const v = await one<any>(`insert into score_versions(score_id, number, content, author_id, description, changes) values ($1,1,$2,$3,'Versión inicial (demostración)',$4) returning id`,
      [s.id, JSON.stringify(doc), emilio, JSON.stringify([{ measure: 0, kind: 'cabecera', detail: `Versión inicial con ${doc.measures.length} compases` }])]);
    await q('update scores set published_version_id = $2 where id = $1', [s.id, v.id]);
  }
  // Partitura general de referencia (sin instrumento): solo como referencia, nunca como «tu parte»
  {
    const doc = score('General', CORNETA_1, MARKS, 0);
    const { pdf } = demoPartPdf('Marcha de demostración (ESTRELLA)', 'Guion general de referencia', doc, 6, 4);
    const file = await storeFile(pdf, 'demo-general.pdf', emilio, ['pdf']);
    await q(`insert into parts(marcha_id, label, file_id, page_count, created_by) values ($1,'Guion general (referencia)',$2,1,$3)`, [marcha.id, file.id, emilio]);
  }
  // Segunda marcha sin partes: muestra el aviso «todavía no disponible»
  await q(`insert into marchas(title, composer, march_type, difficulty, director_notes, is_demo, folder_id, created_by) values
    ('Marcha pendiente de partituras (demo)', null, 'Procesional', 3, 'DEMO · Todavía no se han subido partituras: la app debe indicarlo claramente.', true, $1, $2)`, [folder.id, emilio]);

  // Eventos
  const day = (offset: number, h: number, m = 0) => { const x = new Date(); x.setDate(x.getDate() + offset); x.setHours(h, m, 0, 0); return x; };
  const past = await one<any>(`insert into events(type, title, starts_at, call_at, ends_at, location, notes, responsible_id, status, created_by, summary)
    values ('ensayo','Ensayo general (demo)',$1,$2,$3,'Local de ensayo (demo)','Repaso de la marcha de demostración',$4,'finalizado',$4,$5) returning id`,
    [day(-6, 20, 30), day(-6, 20, 15), day(-6, 22, 30), emilio, JSON.stringify({ worked: 'Introducción y sección A', incidents: 'Entrada del compás 13 descuadrada', tasks: 'Estudiar compases 13–16 con metrónomo a 66', saved_by: 'Emilio García', saved_at: new Date().toISOString() })]);
  await q('insert into event_repertoire values ($1,$2,0)', [past.id, marcha.id]);
  await q(`insert into passage_work(event_id, marcha_id, measure_from, measure_to, note, created_by) values ($1,$2,13,16,'Entrada después del silencio',$3)`, [past.id, marcha.id, emilio]);
  for (const [uid_, st] of [[a, 'presente'], [b, 'retraso'], [c, 'presente'], [d, 'justificada'], [e, 'presente'], [f, 'ausente']] as const) {
    await q(`insert into attendance(event_id, user_id, status, minutes_late, recorded_by) values ($1,$2,$3,$4,$5)`, [past.id, uid_, st, st === 'retraso' ? 10 : null, emilio]);
  }
  const prev = await one<any>(`insert into events(type, title, starts_at, call_at, location, status, created_by) values ('ensayo','Ensayo de cuerda (demo)',$1,$2,'Local de ensayo (demo)','finalizado',$3) returning id`, [day(-13, 20, 30), day(-13, 20, 15), emilio]);
  await q(`insert into passage_work(event_id, marcha_id, measure_from, measure_to, note, created_by) values ($1,$2,13,16,'Primera lectura de la entrada',$3)`, [prev.id, marcha.id, emilio]);
  const next = await one<any>(`insert into events(type, title, starts_at, call_at, ends_at, location, uniform, notes, responsible_id, created_by)
    values ('ensayo','Ensayo (demo)',$1,$2,$3,'Local de ensayo (demo)','Ropa cómoda','Traer la parte descargada en el móvil o tableta',$4,$4) returning id`,
    [day(1, 20, 30), day(1, 20, 15), day(1, 22, 30), emilio]);
  await q('insert into event_repertoire values ($1,$2,0)', [next.id, marcha.id]);
  const plan = [['Calentamiento', null, null, null], ['Marcha de demostración · Introducción', marcha.id, 1, 4], ['Marcha de demostración · Sección B', marcha.id, 13, 20], ['Repetición de la entrada', marcha.id, 13, 16], ['Repaso general', marcha.id, 1, 24], ['Cierre del ensayo', null, null, null]] as const;
  for (const [i, p] of plan.entries()) await q('insert into rehearsal_plan(event_id, sort, title, marcha_id, measure_from, measure_to) values ($1,$2,$3,$4,$5,$6)', [next.id, i, p[0], p[1], p[2], p[3]]);
  await q(`insert into event_rsvp(event_id, user_id, response) values ($1,$2,'asistire'), ($1,$3,'asistire')`, [next.id, a, b]);
  await q(`insert into events(type, title, starts_at, call_at, location, uniform, notes, created_by) values ('procesion','Salida procesional (demo)',$1,$2,'Casa hermandad (demo)','Uniforme completo de gala','Evento ficticio de demostración',$3)`, [day(24, 18), day(24, 17), emilio]);

  await q(`insert into announcements(title, body, urgent, category, author_id) values
    ('Bienvenida a ESTRELLA (demo)','Esta instalación contiene datos de demostración. La dirección debe importar la lista real de componentes y las partituras de la banda.',false,'direccion',$1)`, [emilio]);

  await seedAcademy(emilio);
  return { emilio, marchaId: marcha.id, nextEventId: next.id };
}

async function main() {
  await migrate(false);
  const args = process.argv.slice(2);
  if (args.includes('--director')) {
    const i = args.indexOf('--director');
    const [name, email] = [args[i + 1], args[i + 2]];
    if (!name || !email) throw new Error('Uso: npm run seed -- --director "Nombre" correo@dominio');
    const code = randomToken(12);
    await tx(async (c) => {
      const u = await one<any>(`insert into users(email, password_hash, name, role, status) values (lower($1),$2,$3,'director','inactive') returning id`, [email, hashPassword(randomToken()), name], c);
      await q(`insert into invitations(code, email, role, expires_at, created_by) values ($1,$2,'director', now() + interval '7 days', $3)`, [code, email.toLowerCase(), u.id], c);
    });
    console.log(`Cuenta de dirección creada. Activa la cuenta (válido 7 días): ${config.publicUrl}/registro?codigo=${code}`);
    return;
  }
  if (args.includes('--academy')) { await ensureStructure(); await seedAcademy(null); console.log('Academia sembrada.'); return; }
  if (args.includes('--reset')) {
    if (config.production) throw new Error('No se permite --reset en producción.');
    await pool.query('drop schema public cascade; create schema public;');
    await migrate(false);
    console.log('Base de datos reiniciada.');
  }
  const has = await one('select 1 from users limit 1');
  if (has) { console.log('La base de datos ya tiene usuarios: no se siembra nada (usa --reset en desarrollo).'); return; }
  const r = await seedDemo();
  console.log('Datos de demostración creados.');
  console.log(`  Contraseña común de las cuentas demo: ${DEMO_PASSWORD}`);
  console.log('  Dirección:      emilio@estrella.demo');
  console.log('  Corneta 3ª:     componente.a@estrella.demo');
  console.log('  Trompeta:       componente.b@estrella.demo');
  console.log('  Resp. cornetas: componente.c@estrella.demo (corneta 1ª)');
  console.log(`  Marcha demo:    ${r.marchaId}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
