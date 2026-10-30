import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { q, one } from '../db.ts';
import { config } from '../config.ts';

export const COOKIE = 'estrella_sid';

export type Role = 'director' | 'leader' | 'member';
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  permissions: string[];
  leaderOf: { section_id: number; permissions: string[] }[];
  sectionIds: number[]; // secciones a las que pertenece por sus asignaciones
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: AuthUser; sessionId?: string }
  }
}

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, s, h] = stored.split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(h, 'base64');
  return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
}
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function validatePassword(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < 10) return 'La contraseña debe tener al menos 10 caracteres.';
  if (!/[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(pw) || !/\d/.test(pw)) return 'La contraseña debe combinar letras y números.';
  return null;
}

export async function createSession(res: Response, userId: string, userAgent?: string) {
  const token = randomToken();
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  await q('insert into sessions(id, user_id, expires_at, user_agent) values ($1,$2,$3,$4)', [sha256(token), userId, expires, (userAgent || '').slice(0, 200)]);
  await q('update users set last_login_at = now() where id = $1', [userId]);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.production, expires, path: '/' });
}

export async function loadUserById(id: string): Promise<AuthUser | undefined> {
  const u = await one<any>(`select id, name, email, role, permissions from users where id = $1 and status = 'active'`, [id]);
  if (!u) return undefined;
  const leaderOf = await q<any>('select section_id, permissions from section_leaders where user_id = $1', [id]);
  const secs = await q<any>(`select distinct i.section_id from user_assignments a join instruments i on i.id = a.instrument_id where a.user_id = $1`, [id]);
  return { ...u, leaderOf, sectionIds: secs.map((s) => s.section_id) };
}

export async function userFromToken(token: string | undefined): Promise<{ user: AuthUser; sid: string } | undefined> {
  if (!token) return undefined;
  const sid = sha256(token);
  const s = await one<any>('select user_id, last_seen_at from sessions where id = $1 and expires_at > now()', [sid]);
  if (!s) return undefined;
  const user = await loadUserById(s.user_id);
  if (!user) return undefined;
  if (Date.now() - new Date(s.last_seen_at).getTime() > 5 * 60_000) {
    q('update sessions set last_seen_at = now() where id = $1', [sid]).catch(() => {});
  }
  return { user, sid };
}

export async function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    const r = await userFromToken(req.cookies?.[COOKIE]);
    if (r) { req.user = r.user; req.sessionId = r.sid; }
    next();
  } catch (e) { next(e); }
}

/** Protección CSRF: las mutaciones deben incluir una cabecera personalizada (no enviable desde otro origen sin CORS). */
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-estrella') !== '1') return res.status(403).json({ error: 'Solicitud rechazada (CSRF).' });
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Debes iniciar sesión.' });
  next();
}

// ===== Permisos =====
// Permisos globales que la dirección puede conceder a cualquier usuario:
export const GLOBAL_PERMISSIONS = {
  'scores.publish': 'Editar y publicar partituras oficiales',
  'library.manage': 'Gestionar biblioteca (marchas, archivos, sustituir partituras)',
  'events.manage': 'Crear y modificar eventos y ensayos',
  'annotate.official': 'Anotar en la capa oficial',
  'assignments.manage': 'Modificar asignaciones musicales oficiales y estructura de voces',
  'live.direct': 'Dirigir sesiones de ensayo en directo',
  'members.manage': 'Gestionar fichas de componentes',
  'announce.all': 'Publicar avisos a toda la banda',
  'academy.manage': 'Crear y revisar contenidos de la academia',
  'stats.view': 'Consultar estadísticas de dirección',
} as const;
// Permisos que se pueden conceder a un responsable dentro de su sección:
export const SECTION_PERMISSIONS = {
  attendance: 'Registrar asistencia de su sección',
  members: 'Ver fichas y contacto de su sección',
  announce: 'Publicar avisos a su sección',
  annotate: 'Anotar oficialmente para su sección',
  doubts: 'Responder dudas de su sección',
  lessons: 'Revisar materiales de la academia',
} as const;

export function can(user: AuthUser | undefined, perm: string, sectionId?: number | null): boolean {
  if (!user) return false;
  if (user.role === 'director') return true;
  if (user.permissions.includes(perm)) return true;
  if (user.role === 'leader') {
    if (sectionId != null) return user.leaderOf.some((l) => l.section_id === sectionId && l.permissions.includes(perm));
  }
  return false;
}
/** Secciones en las que el usuario tiene un permiso de responsable (o todas si es dirección). 'all' = sin restricción. */
export function sectionsWith(user: AuthUser, perm: string, globalPerm?: string): number[] | 'all' {
  if (user.role === 'director' || (globalPerm && user.permissions.includes(globalPerm))) return 'all';
  return user.leaderOf.filter((l) => l.permissions.includes(perm)).map((l) => l.section_id);
}
export const isStaff = (u?: AuthUser) => !!u && (u.role === 'director' || u.role === 'leader');

export function requirePerm(perm: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Debes iniciar sesión.' });
    if (!can(req.user, perm)) return res.status(403).json({ error: 'No tienes permiso para esta acción.' });
    next();
  };
}

// Límite de intentos de inicio de sesión (memoria del proceso)
const attempts = new Map<string, { n: number; first: number }>();
export function loginRateLimited(key: string): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.first > 15 * 60_000) { attempts.set(key, { n: 1, first: now }); return false; }
  a.n++;
  return a.n > 10;
}
export function clearLoginAttempts(key: string) { attempts.delete(key); }
