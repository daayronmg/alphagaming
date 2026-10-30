import pg from 'pg';
import { config } from './config.ts';

pg.types.setTypeParser(1082, (v) => v); // date como texto YYYY-MM-DD
pg.types.setTypeParser(20, (v) => Number(v)); // bigint → number

const sslFor = (url: string) =>
  // Conexiones remotas (Supabase, etc.) requieren SSL
  !/localhost|127\.0\.0\.1|@db:/.test(url) || process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined;

/**
 * Supabase sin DATABASE_URL: con la referencia del proyecto, la región y la contraseña de la app
 * se prueban los servidores del «Session pooler» hasta encontrar el que corresponde al proyecto.
 */
async function resolveUrl(): Promise<string> {
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (process.env.DATABASE_URL || !ref) return config.databaseUrl;
  const region = process.env.SUPABASE_REGION || 'eu-west-3';
  const user = `${process.env.DB_USER || 'estrella_app'}.${ref}`;
  const pw = encodeURIComponent(process.env.DB_PASSWORD || '');
  const errors: string[] = [];
  for (const host of [`aws-1-${region}`, `aws-0-${region}`, `aws-2-${region}`]) {
    const url = `postgresql://${user}:${pw}@${host}.pooler.supabase.com:5432/postgres`;
    const c = new pg.Client({ connectionString: url, ssl: sslFor(url), connectionTimeoutMillis: 8000 });
    try {
      await c.connect();
      await c.end();
      console.log(`Base de datos: conectado a Supabase (${host}).`);
      return url;
    } catch (e) {
      errors.push(`${host}: ${(e as Error).message}`);
      await c.end().catch(() => {});
    }
  }
  throw new Error(`No se pudo conectar con Supabase (${ref}). ¿Es correcta DB_PASSWORD?\n${errors.join('\n')}`);
}

const url = await resolveUrl();
export const pool = new pg.Pool({
  connectionString: url.replace(/[?&]sslmode=[^&]*/, ''),
  max: Number(process.env.DB_POOL_MAX || 10),
  ssl: sslFor(url),
});

export type Db = pg.Pool | pg.PoolClient;

export async function q<T = any>(text: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const r = await db.query(text, params as any[]);
  return r.rows as T[];
}
export async function one<T = any>(text: string, params: unknown[] = [], db: Db = pool): Promise<T | undefined> {
  return (await q<T>(text, params, db))[0];
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

export async function audit(userId: string | null, action: string, entity: string, entityId: string | null, data?: unknown, db: Db = pool) {
  await q('insert into audit_log(user_id, action, entity, entity_id, data) values ($1,$2,$3,$4,$5)', [userId, action, entity, entityId, data ? JSON.stringify(data) : null], db);
}
