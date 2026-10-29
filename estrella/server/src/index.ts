import http from 'node:http';
import fs from 'node:fs';
import { config } from './config.ts';
import { createApp } from './app.ts';
import { attachRealtime } from './realtime.ts';
import { migrate } from './migrate.ts';
import { applyDueAssignmentChanges } from './routes/members.ts';
import { pool } from './db.ts';

await migrate();
fs.mkdirSync(config.storageDir, { recursive: true });
const app = createApp();
const server = http.createServer(app);
attachRealtime(server);

// tareas periódicas: cambios de asignación con fecha y limpieza de sesiones caducadas
const housekeeping = async () => {
  try {
    await applyDueAssignmentChanges();
    await pool.query('delete from sessions where expires_at < now()');
  } catch (e) { console.error('[mantenimiento]', e); }
};
housekeeping();
setInterval(housekeeping, 60 * 60_000);

server.listen(config.port, () => console.log(`${config.appName} escuchando en http://localhost:${config.port}`));
const stop = () => { server.close(); pool.end().finally(() => process.exit(0)); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
