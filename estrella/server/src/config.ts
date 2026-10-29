import fs from 'node:fs';
import path from 'node:path';

// Carga sencilla de .env sin dependencias
const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;
export const config = {
  appName: env.APP_NAME || 'ESTRELLA',
  databaseUrl: env.DATABASE_URL || 'postgres://estrella:estrella_dev@localhost:5432/estrella',
  port: Number(env.PORT || 4000),
  publicUrl: env.PUBLIC_URL || 'http://localhost:5173',
  production: env.NODE_ENV === 'production',
  storageDir: path.resolve(env.STORAGE_DIR || './storage'),
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 60),
  sessionDays: 30,
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  anthropicModel: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  audiverisPath: env.AUDIVERIS_PATH || '',
  smtpUrl: env.SMTP_URL || '',
  mailFrom: env.MAIL_FROM || 'ESTRELLA <no-responder@example.com>',
  webDist: path.resolve(env.WEB_DIST || '../web/dist'),
};
