/**
 * Libretos incluidos con la aplicación (carpeta server/libretos): al arrancar, si una voz todavía no tiene
 * sus marchas cargadas, se importa el libreto y se leen sus notas. Así la banda tiene el repertorio
 * nada más desplegar, sin tener que subir nada a mano. Es idempotente: no vuelve a cargar lo que ya existe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, one, tx } from '../db.ts';
import { storeFile } from './files.ts';
import { detectBook, type PageText } from '../../../shared/book.ts';
import { shapesFromOperatorList, transcribe, type PageShapes } from '../../../shared/pdfMusic.ts';
import { validateScore } from '../../../shared/music.ts';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../libretos');

interface Book { file: string; instrument: string; voice?: string; label: string }

async function readPdf(buf: Buffer) {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), fontExtraProperties: true, verbosity: 0, isEvalSupported: false }).promise;
  const texts: PageText[] = [];
  const shapes: PageShapes[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    texts.push({ width: vp.width, height: vp.height, items: tc.items.filter((it: any) => 'str' in it).map((it: any) => {
      const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
      return { str: it.str, x, y, size: Math.hypot(it.transform[2], it.transform[3]) };
    }) });
    const ol = await page.getOperatorList();
    const [x0, y0, x1, y1] = page.view;
    shapes.push(shapesFromOperatorList(ol, pdfjs.OPS, { width: x1 - x0, height: y1 - y0, x0, y0 },
      (id) => { try { return page.commonObjs.get(id)?.name ?? ''; } catch { return ''; } }));
    page.cleanup();
  }
  await doc.destroy();
  return { texts, shapes };
}

export async function importBundledBooks() {
  const list = path.join(dir, 'libretos.json');
  if (!fs.existsSync(list)) return;
  const books: Book[] = JSON.parse(fs.readFileSync(list, 'utf8'));
  const owner = await one<any>(`select id from users where role = 'director' and status = 'active' order by is_demo, created_at limit 1`);
  for (const b of books) {
    const file = path.join(dir, b.file);
    if (!fs.existsSync(file)) continue;
    const inst = await one<any>('select id, transposition from instruments where name = $1', [b.instrument]);
    if (!inst) { console.warn(`[libretos] No existe el instrumento «${b.instrument}»: se omite ${b.file}.`); continue; }
    const voice = b.voice ? await one<any>('select id from voices where instrument_id = $1 and name = $2', [inst.id, b.voice]) : null;
    if (b.voice && !voice) { console.warn(`[libretos] No existe la voz «${b.voice}»: se omite ${b.file}.`); continue; }
    // ya cargado (por esta tarea o a mano desde «Importar libreto»)
    const done = await one('select 1 from audit_log where action = $1 and entity = $2 and data->>\'file\' = $3 limit 1', ['import_book', 'library', b.file]);
    if (done) continue;
    const loaded = await one(`select 1 from parts p join marchas m on m.id = p.marcha_id where p.active and not m.is_demo and p.instrument_id = $1 and p.voice_id is not distinct from $2 limit 1`, [inst.id, voice?.id ?? null]);
    if (loaded) continue;
    const buf = fs.readFileSync(file);
    const t0 = Date.now();
    const { texts, shapes } = await readPdf(buf);
    const entries = detectBook(texts);
    let notes = 0;
    await tx(async (c) => {
      const f = await storeFile(buf, b.file, owner?.id ?? null, ['pdf'], c);
      for (const e of entries) {
        let m = await one<any>('select id from marchas where not is_demo and unaccent_lower(title) = unaccent_lower($1) order by created_at limit 1', [e.title], c);
        if (!m) {
          m = await one<any>('insert into marchas(title, composer, created_by) values ($1,$2,$3) returning id', [e.title, e.composer || null, owner?.id ?? null], c);
          await q('insert into marcha_changes(marcha_id, user_id, summary) values ($1,$2,$3)', [m.id, owner?.id ?? null, 'Marcha creada al cargar el libreto'], c);
        }
        const old = await one<any>('select id, version from parts where marcha_id = $1 and active and instrument_id = $2 and voice_id is not distinct from $3', [m.id, inst.id, voice?.id ?? null], c);
        if (old) await q('update parts set active = false where id = $1', [old.id], c);
        const part = await one<any>(`insert into parts(marcha_id, instrument_id, voice_id, label, file_id, page_count, page_from, page_to, version, replaces_part_id, created_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
          [m.id, inst.id, voice?.id ?? null, b.label, f.id, e.to - e.from + 1, e.from, e.to, old ? old.version + 1 : 1, old?.id ?? null, owner?.id ?? null], c);
        await q('insert into marcha_changes(marcha_id, user_id, summary) values ($1,$2,$3)', [m.id, owner?.id ?? null, `Partitura «${b.label}» cargada del libreto`], c);
        // notas: solo si la voz no tiene ya una partitura editable
        const t = transcribe(shapes.slice(e.from - 1, e.to), { title: e.title, transposition: inst.transposition ?? 0 });
        if (!t.notes || validateScore(t.doc)) continue;
        if (await one('select 1 from scores where marcha_id = $1 and instrument_id = $2 and voice_id is not distinct from $3', [m.id, inst.id, voice?.id ?? null], c)) continue;
        const s = await one<any>(`insert into scores(marcha_id, instrument_id, voice_id, part_id, label, source, draft, needs_review, review_measures)
          values ($1,$2,$3,$4,$5,'pdf',$6,$7,$8) returning id`, [m.id, inst.id, voice?.id ?? null, part.id, b.label, JSON.stringify(t.doc), t.review.length > 0, t.review], c);
        const v = await one<any>(`insert into score_versions(score_id, number, content, author_id, description, changes) values ($1,1,$2,$3,$4,'[]') returning id`,
          [s.id, JSON.stringify(t.doc), owner?.id ?? null, `Notas leídas automáticamente del PDF${t.review.length ? ` · ${t.review.length} compases por revisar` : ''}`], c);
        await q('update scores set published_version_id = $2 where id = $1', [s.id, v.id], c);
        notes++;
      }
      await q('insert into audit_log(user_id, action, entity, entity_id, data) values ($1,$2,$3,$4,$5)',
        [owner?.id ?? null, 'import_book', 'library', null, JSON.stringify({ file: b.file, label: b.label, count: entries.length, automatic: true })], c);
    });
    console.log(`[libretos] ${b.file}: ${entries.length} marchas cargadas, ${notes} con notas (${Math.round((Date.now() - t0) / 1000)} s).`);
  }
}
