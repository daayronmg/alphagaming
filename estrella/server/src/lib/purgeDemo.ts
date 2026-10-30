/**
 * Paso a uso real: borra una sola vez los datos de demostración (cuentas @estrella.demo de prueba,
 * marchas, ensayos y avisos inventados) y, si se indica, pone una contraseña nueva a la dirección.
 * Se activa con PURGE_DEMO=1; la contraseña llega ya cifrada en DIRECTOR_PASSWORD_HASH (nunca en el código).
 * Queda anotado en settings para no repetirse en cada arranque.
 */
import { q, one, tx, audit } from '../db.ts';

export async function purgeDemoOnce() {
  if (process.env.PURGE_DEMO !== '1') return;
  if (await one(`select 1 from settings where key = 'demo_purged'`)) return;
  const hash = process.env.DIRECTOR_PASSWORD_HASH;
  const r = await tx(async (c) => {
    const n = (sql: string, p: unknown[] = []) => c.query(sql, p).then((x) => x.rowCount ?? 0);
    const out = {
      directos: await n('update live_sessions set active = false, ended_at = now() where active'),
      marchas: await n('delete from marchas where is_demo'),
      archivos: await n(`delete from files f where f.original_name like 'demo-%' and not exists (select 1 from parts p where p.file_id = f.id)`),
      eventos: await n(`delete from events where title like '%(demo)'`),
      avisos: await n(`delete from announcements where title like '%(demo)%'`),
      cuentas: await n(`delete from users where is_demo and role <> 'director'`),
      direccion: 0,
    };
    if (hash?.startsWith('scrypt$')) {
      out.direccion = await n(`update users set is_demo = false, password_hash = $1 where role = 'director' and is_demo`, [hash]);
      await n(`delete from sessions where user_id in (select id from users where role = 'director')`);
    }
    await q(`insert into settings(key, value) values ('demo_purged', $1)`, [JSON.stringify({ at: new Date().toISOString(), ...out })], c);
    await audit(null, 'purge_demo', 'settings', null, out, c);
    return out;
  });
  console.log('[demo] datos de demostración eliminados:', JSON.stringify(r));
}
