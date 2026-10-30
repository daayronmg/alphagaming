import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.ts';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export async function migrate(log = true) {
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await pool.query('select name from schema_migrations')).rows.map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await c.query('insert into schema_migrations(name) values ($1)', [f]);
      await c.query('commit');
      if (log) console.log('migración aplicada:', f);
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
