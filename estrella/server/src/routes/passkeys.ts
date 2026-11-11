// Entrar con Face ID, Touch ID o huella (passkeys). La clave privada nunca sale del móvil.
import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { q, one, audit } from '../db.ts';
import { h, parse, HttpError } from '../lib/http.ts';
import { createSession, requireAuth, randomToken, loginRateLimited } from '../lib/auth.ts';
import { config } from '../config.ts';

export const passkeyRouter = Router();

/** Origen y dominio para WebAuthn: solo el de la app (y localhost en desarrollo). */
function rp(req: Request) {
  const origin = req.get('origin') || config.publicUrl;
  let host: string;
  try { host = new URL(origin).hostname; } catch { throw new HttpError(400, 'Origen no válido.'); }
  const allowed = [config.publicUrl, process.env.RENDER_EXTERNAL_URL].filter(Boolean).map((u) => new URL(u as string).hostname.replace(/^www\./, ''));
  const base = host.replace(/^www\./, '');
  if (!(host === 'localhost' || allowed.includes(base))) throw new HttpError(400, 'Origen no permitido.');
  return { origin, rpID: base };
}

// Retos pendientes (un solo servidor): id → reto, caducan a los 5 minutos
const challenges = new Map<string, { challenge: string; userId?: string; exp: number }>();
function keep(challenge: string, userId?: string) {
  const id = randomToken(12);
  const now = Date.now();
  for (const [k, v] of challenges) if (v.exp < now) challenges.delete(k);
  challenges.set(id, { challenge, userId, exp: now + 5 * 60_000 });
  return id;
}
function take(id: string) {
  const c = challenges.get(id);
  challenges.delete(id);
  if (!c || c.exp < Date.now()) throw new HttpError(400, 'Se ha tardado demasiado. Inténtalo otra vez.');
  return c;
}

passkeyRouter.get('/', requireAuth, h(async (req, res) => {
  res.json(await q('select id, device, created_at, last_used_at from webauthn_credentials where user_id = $1 order by created_at', [req.user!.id]));
}));

passkeyRouter.post('/register/options', requireAuth, h(async (req, res) => {
  const { rpID } = rp(req);
  const u = await one<any>('select id, name, email, phone from users where id = $1', [req.user!.id]);
  const existing = await q<any>('select id, transports from webauthn_credentials where user_id = $1', [u.id]);
  const options = await generateRegistrationOptions({
    rpName: config.appName, rpID,
    userID: new TextEncoder().encode(u.id),
    userName: /@sin-correo\./.test(u.email) ? (u.phone || u.name) : u.email,
    userDisplayName: u.name,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  res.json({ options, challengeId: keep(options.challenge, u.id) });
}));

passkeyRouter.post('/register/verify', requireAuth, h(async (req, res) => {
  const b = parse(z.object({ challengeId: z.string(), response: z.any(), device: z.string().max(80).optional() }), req.body);
  const c = take(b.challengeId);
  if (c.userId !== req.user!.id) throw new HttpError(400, 'Reto no válido.');
  const { origin, rpID } = rp(req);
  let v;
  try { v = await verifyRegistrationResponse({ response: b.response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false }); }
  catch (e) { throw new HttpError(400, `No se pudo activar: ${(e as Error).message}`); }
  if (!v.verified || !v.registrationInfo) throw new HttpError(400, 'No se pudo activar.');
  const cred = v.registrationInfo.credential;
  await q(`insert into webauthn_credentials(id, user_id, public_key, counter, transports, device) values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing`,
    [cred.id, req.user!.id, Buffer.from(cred.publicKey), cred.counter, cred.transports ?? [], b.device ?? null]);
  await audit(req.user!.id, 'passkey_add', 'user', req.user!.id);
  res.json({ ok: true });
}));

passkeyRouter.delete('/:id', requireAuth, h(async (req, res) => {
  await q('delete from webauthn_credentials where id = $1 and user_id = $2', [req.params.id, req.user!.id]);
  res.json({ ok: true });
}));

passkeyRouter.post('/login/options', h(async (req, res) => {
  const { rpID } = rp(req);
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred', allowCredentials: [] });
  res.json({ options, challengeId: keep(options.challenge) });
}));

passkeyRouter.post('/login/verify', h(async (req, res) => {
  const b = parse(z.object({ challengeId: z.string(), response: z.object({ id: z.string() }).passthrough() }), req.body);
  if (loginRateLimited(`passkey|${req.ip}`)) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.');
  const c = take(b.challengeId);
  const cred = await one<any>(`select w.*, u.status from webauthn_credentials w join users u on u.id = w.user_id where w.id = $1`, [b.response.id]);
  if (!cred) throw new HttpError(401, 'Este Face ID no está vinculado a ninguna cuenta. Entra con tu contraseña y actívalo de nuevo.');
  if (cred.status !== 'active') throw new HttpError(403, 'Tu cuenta no está activa. Contacta con la dirección.');
  const { origin, rpID } = rp(req);
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: b.response as any, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
      credential: { id: cred.id, publicKey: new Uint8Array(cred.public_key), counter: Number(cred.counter), transports: cred.transports },
    });
  } catch (e) { throw new HttpError(401, `No se pudo comprobar: ${(e as Error).message}`); }
  if (!v.verified) throw new HttpError(401, 'No se pudo comprobar.');
  await q('update webauthn_credentials set counter = $2, last_used_at = now() where id = $1', [cred.id, v.authenticationInfo.newCounter]);
  await createSession(res, cred.user_id, req.get('user-agent'));
  await audit(cred.user_id, 'login', 'user', cred.user_id, { passkey: true });
  res.json({ ok: true });
}));
