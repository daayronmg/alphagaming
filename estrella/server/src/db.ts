import pg from 'pg';
import { config } from './config.ts';

pg.types.setTypeParser(1082, (v) => v); // date como texto YYYY-MM-DD
pg.types.setTypeParser(20, (v) => Number(v)); // bigint → number

// Conexiones remotas (Supabase, etc.) requieren SSL
const remote = !/localhost|127\.0\.0\.1|@db:/.test(config.databaseUrl);
export const pool = new pg.Pool({
  connectionString: config.databaseUrl.replace(/[?&]sslmode=[^&]*/, ''),
  max: Number(process.env.DB_POOL_MAX || 10),
  ssl: remote || process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined,
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
