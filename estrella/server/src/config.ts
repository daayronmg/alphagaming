import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// rutas relativas a la carpeta del servidor, independientemente del directorio de trabajo
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Carga sencilla de .env sin dependencias
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;

/**
 * Permite pegar tal cual la cadena «Session pooler» de Supabase (con [YOUR-PASSWORD])
 * y dar aparte el usuario y la contraseña de la app (DB_USER, DB_PASSWORD).
 */
function databaseUrl(): string {
  let url = env.DATABASE_URL || 'postgres://estrella:estrella_dev@localhost:5432/estrella';
  if (!env.DB_PASSWORD && !env.DB_USER) return url;
  const u = new URL(url.replace('[YOUR-PASSWORD]', 'x'));
  if (env.DB_USER) {
    // en el pooler de Supabase el usuario lleva el sufijo «.referencia-del-proyecto»
    const suffix = u.username.includes('.') ? u.username.slice(u.username.indexOf('.')) : '';
    u.username = env.DB_USER.includes('.') ? env.DB_USER : env.DB_USER + suffix;
  }
  if (env.DB_PASSWORD) u.password = encodeURIComponent(env.DB_PASSWORD);
  url = u.toString();
  return url;
}
export const config = {
  appName: env.APP_NAME || 'ESTRELLA',
  databaseUrl: databaseUrl(),
  port: Number(env.PORT || 4000),
  publicUrl: env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || 'http://localhost:5173',
  production: env.NODE_ENV === 'production',
  storageDir: path.resolve(root, env.STORAGE_DIR || './storage'),
  // 'disk' (carpeta privada) o 'db' (dentro de PostgreSQL, para alojamientos sin disco persistente)
  storageMode: (env.STORAGE_MODE === 'db' ? 'db' : 'disk') as 'db' | 'disk',
  seedDemo: env.SEED_DEMO === '1',
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 60),
  sessionDays: 30,
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  anthropicModel: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  audiverisPath: env.AUDIVERIS_PATH || '',
  smtpUrl: env.SMTP_URL || '',
  mailFrom: env.MAIL_FROM || 'ESTRELLA <no-responder@example.com>',
  webDist: path.resolve(root, env.WEB_DIST || '../web/dist'),
};
