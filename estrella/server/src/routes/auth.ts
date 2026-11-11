import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx, audit } from '../db.ts';
import { h, parse, HttpError } from '../lib/http.ts';
import {
  COOKIE, createSession, hashPassword, verifyPassword, validatePassword, sha256, randomToken, requireAuth,
  loginRateLimited, clearLoginAttempts, GLOBAL_PERMISSIONS, SECTION_PERMISSIONS,
  forgetSession, forgetUser,
} from '../lib/auth.ts';
import { config } from '../config.ts';
import { sendMail } from '../lib/mail.ts';
import { userAssignments } from './members.ts';

export const authRouter = Router();

/** Últimas 9 cifras de un teléfono español (quita +34 / 0034, espacios y guiones). */
export function phoneKey(v: string): string | null {
  const d = v.replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : null;
}

async function findLoginUser(login: string) {
  if (login.includes('@')) return one<any>('select id, password_hash, status from users where lower(email) = lower($1)', [login]);
  const k = phoneKey(login);
  if (!k) return null;
  const rows = await q<any>(`select id, password_hash, status from users where right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 9) = $1 limit 2`, [k]);
  return rows.length === 1 ? rows[0] : null; // un número repetido en dos fichas no sirve para entrar
}

authRouter.post('/login', h(async (req, res) => {
  // `email` admite el correo o el número de teléfono de la ficha
  const { email, password } = parse(z.object({ email: z.string().trim().min(3).max(200), password: z.string().max(200) }), req.body);
  const key = `${req.ip}|${email.toLowerCase()}`;
  if (loginRateLimited(key)) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.');
  const u = await findLoginUser(email);
  if (!u || !verifyPassword(password, u.password_hash)) throw new HttpError(401, 'Usuario o contraseña incorrectos.');
  if (u.status !== 'active') throw new HttpError(403, 'Tu cuenta no está activa. Contacta con la dirección.');
  clearLoginAttempts(key);
  await createSession(res, u.id, req.get('user-agent'));
  await audit(u.id, 'login', 'user', u.id);
  res.json({ ok: true });
}));

authRouter.post('/logout', h(async (req, res) => {
  if (req.sessionId) { await q('delete from sessions where id = $1', [req.sessionId]); forgetSession(req.sessionId); }
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));

authRouter.get('/me', h(async (req, res) => {
  if (!req.user) return res.json({ user: null });
  const u = await one<any>('select id, name, email, role, permissions, phone, share_contact, joined_at, photo_file_id from users where id = $1', [req.user.id]);
  const prefs = await one<any>('select mute_non_urgent, categories from notification_prefs where user_id = $1', [req.user.id]);
  res.json({
    user: { ...u, leaderOf: req.user.leaderOf, sectionIds: req.user.sectionIds, assignments: await userAssignments(req.user.id), privateLibrary: (u.permissions ?? []).includes('library.private') },
    prefs: prefs ?? { mute_non_urgent: false, categories: { avisos: true, eventos: true, dudas: true, partituras: true } },
    catalog: { global: GLOBAL_PERMISSIONS, section: SECTION_PERMISSIONS },
  });
}));

// Registro controlado: solo con un código de invitación emitido por la dirección
authRouter.get('/invitation/:code', h(async (req, res) => {
  const inv = await one<any>(`select i.code, i.email, i.name, i.role, i.open, i.expires_at, ins.name as instrument, v.name as voice
    from invitations i left join instruments ins on ins.id = i.instrument_id left join voices v on v.id = i.voice_id
    where i.code = $1 and i.used_at is null and i.expires_at > now()`, [req.params.code]);
  if (!inv) throw new HttpError(404, 'Invitación no válida o caducada.');
  if (inv.open) {
    // Para el alta por enlace: instrumentos y voces que puede elegir (la dirección nunca se elige)
    inv.instruments = await q<any>(`select i.id, i.name, s.name as section, s.family,
        coalesce((select json_agg(json_build_object('id', v.id, 'name', v.name) order by v.sort, v.id) from voices v where v.instrument_id = i.id), '[]') as voices
      from instruments i join sections s on s.id = i.section_id order by s.sort, s.id, i.sort, i.id`);
  }
  res.json(inv);
}));

// Alta con un enlace abierto: nombre, teléfono, contraseña, instrumento y voz. Siempre como componente.
authRouter.post('/join', h(async (req, res) => {
  const b = parse(z.object({
    code: z.string().min(6).max(80),
    name: z.string().trim().min(2, 'Escribe tu nombre y apellidos.').max(120),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().email('Escribe un correo válido: ahí te llegan los avisos de ensayos.').max(200),
    password: z.string().max(200),
    instrument_id: z.number().int(),
    voice_id: z.number().int().nullable().optional(),
  }), req.body);
  if (loginRateLimited(`join|${req.ip}`)) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.');
  const k = b.phone ? phoneKey(b.phone) : null;
  if (b.phone && !k) throw new HttpError(400, 'Escribe un número de teléfono válido.');
  const pwErr = validatePassword(b.password);
  if (pwErr) throw new HttpError(400, pwErr);
  const userId = await tx(async (c) => {
    const inv = await one<any>('select code from invitations where code = $1 and open and expires_at > now() for update', [b.code], c);
    if (!inv) throw new HttpError(404, 'Este enlace no es válido o ya ha caducado. Pide uno nuevo a la dirección.');
    if (!(await one('select 1 from instruments where id = $1', [b.instrument_id], c))) throw new HttpError(400, 'Elige tu instrumento.');
    const hasVoices = await one('select 1 from voices where instrument_id = $1 limit 1', [b.instrument_id], c);
    if (b.voice_id) {
      if (!(await one('select 1 from voices where id = $1 and instrument_id = $2', [b.voice_id, b.instrument_id], c))) throw new HttpError(400, 'La voz elegida no es de ese instrumento.');
    } else if (hasVoices) throw new HttpError(400, 'Elige tu voz.');
    if (k && await one(`select 1 from users where right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 9) = $1`, [k], c)) {
      throw new HttpError(409, 'Ya hay una cuenta con ese teléfono. Entra con él; si no recuerdas la contraseña, pídesela a la dirección.');
    }
    const email = b.email.toLowerCase();
    if (await one('select 1 from users where lower(email) = $1', [email], c)) throw new HttpError(409, 'Ya hay una cuenta con ese correo. Entra con él; si no recuerdas la contraseña, pulsa «¿Has olvidado la contraseña?».');
    const u = await one<any>(`insert into users(email, password_hash, name, role, joined_at, phone) values ($1,$2,$3,'member',current_date,$4) returning id`,
      [email, hashPassword(b.password), b.name, b.phone || null], c);
    const asg = [{ instrument_id: b.instrument_id, voice_id: b.voice_id ?? null, is_default: true }];
    await q('insert into user_assignments(user_id, instrument_id, voice_id, is_default) values ($1,$2,$3,true)', [u.id, b.instrument_id, b.voice_id ?? null], c);
    await q(`insert into assignment_changes(user_id, before, after, status, reason, requested_by, applied_by, applied_at) values ($1,'[]',$2,'aplicado','Alta con enlace de invitación',$1,$1,now())`, [u.id, JSON.stringify(asg)], c);
    await q('update invitations set uses = uses + 1 where code = $1', [b.code], c);
    await audit(u.id, 'register', 'user', u.id, { invitation: b.code, open: true }, c);
    return u.id as string;
  });
  await createSession(res, userId, req.get('user-agent'));
  res.json({ ok: true });
}));

authRouter.post('/register', h(async (req, res) => {
  const b = parse(z.object({ code: z.string().min(6).max(80), name: z.string().min(2).max(120), email: z.string().email().max(200), password: z.string().max(200) }), req.body);
  const pwErr = validatePassword(b.password);
  if (pwErr) throw new HttpError(400, pwErr);
  const userId = await tx(async (c) => {
    const inv = await one<any>('select * from invitations where code = $1 and not open and used_at is null and expires_at > now() for update', [b.code], c);
    if (!inv) throw new HttpError(404, 'Invitación no válida o caducada.');
    if (inv.email && inv.email.toLowerCase() !== b.email.toLowerCase()) throw new HttpError(400, 'Esta invitación está asociada a otro correo electrónico.');
    // Si la dirección ya creó la ficha con ese correo, la invitación activa esa ficha (no crea otra)
    const existing = await one<any>('select id, status from users where lower(email) = lower($1)', [b.email], c);
    let id: string;
    if (existing) {
      if (!inv.email) throw new HttpError(409, 'Ya existe una cuenta con ese correo.');
      id = existing.id;
      await q(`update users set password_hash = $2, name = coalesce(nullif($3,''), name), status = 'active' where id = $1`, [id, hashPassword(b.password), b.name], c);
    } else {
      // El rol de la invitación lo fijó la dirección; el correo por sí solo nunca concede permisos
      const u = await one<any>(`insert into users(email, password_hash, name, role, joined_at) values ($1,$2,$3,$4,current_date) returning id`,
        [b.email.toLowerCase(), hashPassword(b.password), b.name, inv.role], c);
      id = u.id;
      if (inv.instrument_id) await q('insert into user_assignments(user_id, instrument_id, voice_id, is_default) values ($1,$2,$3,true)', [id, inv.instrument_id, inv.voice_id], c);
    }
    await q('update invitations set used_by = $2, used_at = now() where code = $1', [b.code, id], c);
    await audit(id, 'register', 'user', id, { invitation: b.code }, c);
    return id;
  });
  await createSession(res, userId, req.get('user-agent'));
  res.json({ ok: true });
}));

// Recuperación de contraseña. Respuesta neutra para no revelar qué correos existen.
authRouter.post('/forgot', h(async (req, res) => {
  const { email } = parse(z.object({ email: z.string().email() }), req.body);
  if (loginRateLimited(`forgot|${req.ip}`)) throw new HttpError(429, 'Demasiadas solicitudes.');
  const u = await one<any>(`select id, email from users where lower(email) = lower($1) and status = 'active'`, [email]);
  if (u) {
    const token = randomToken();
    await q(`insert into password_resets(token_hash, user_id, expires_at) values ($1,$2, now() + interval '1 hour')`, [sha256(token), u.id]);
    const link = `${config.publicUrl}/restablecer/${token}`;
    const sent = await sendMail(u.email, `${config.appName}: recuperar contraseña`, `Para crear una nueva contraseña abre este enlace (válido 1 hora):\n${link}\n\nSi no lo has solicitado, ignora este mensaje.`);
    if (!sent && !config.production) console.log(`[dev] enlace de recuperación para ${u.email}: ${link}`);
  }
  res.json({ ok: true, message: 'Si el correo pertenece a una cuenta activa, recibirás un enlace. Si la banda no tiene correo configurado, pide a la dirección un enlace de restablecimiento.' });
}));

authRouter.post('/reset', h(async (req, res) => {
  const b = parse(z.object({ token: z.string().min(20).max(200), password: z.string().max(200) }), req.body);
  const pwErr = validatePassword(b.password);
  if (pwErr) throw new HttpError(400, pwErr);
  await tx(async (c) => {
    const r = await one<any>('select user_id from password_resets where token_hash = $1 and used_at is null and expires_at > now() for update', [sha256(b.token)], c);
    if (!r) throw new HttpError(400, 'El enlace no es válido o ha caducado.');
    await q('update password_resets set used_at = now() where token_hash = $1', [sha256(b.token)], c);
    await q('update users set password_hash = $2 where id = $1', [r.user_id, hashPassword(b.password)], c);
    await q('delete from sessions where user_id = $1', [r.user_id], c); // cierra todas las sesiones
    forgetUser(r.user_id);
    await audit(r.user_id, 'password_reset', 'user', r.user_id, null, c);
  });
  res.json({ ok: true });
}));

authRouter.post('/password', requireAuth, h(async (req, res) => {
  const b = parse(z.object({ current: z.string().max(200), password: z.string().max(200) }), req.body);
  const u = await one<any>('select password_hash from users where id = $1', [req.user!.id]);
  if (!verifyPassword(b.current, u.password_hash)) throw new HttpError(400, 'La contraseña actual no es correcta.');
  const pwErr = validatePassword(b.password);
  if (pwErr) throw new HttpError(400, pwErr);
  await q('update users set password_hash = $2 where id = $1', [req.user!.id, hashPassword(b.password)]);
  await q('delete from sessions where user_id = $1 and id <> $2', [req.user!.id, req.sessionId]);
  forgetUser(req.user!.id);
  res.json({ ok: true });
}));

authRouter.get('/sessions', requireAuth, h(async (req, res) => {
  const rows = await q<any>('select id, created_at, last_seen_at, user_agent from sessions where user_id = $1 and expires_at > now() order by last_seen_at desc', [req.user!.id]);
  res.json(rows.map((r) => ({ ...r, id: r.id.slice(0, 12), current: r.id === req.sessionId })));
}));
authRouter.delete('/sessions/:prefix', requireAuth, h(async (req, res) => {
  await q(`delete from sessions where user_id = $1 and left(id, 12) = $2 and id <> $3`, [req.user!.id, req.params.prefix, req.sessionId]);
  forgetUser(req.user!.id);
  res.json({ ok: true });
}));

authRouter.put('/prefs', requireAuth, h(async (req, res) => {
  const b = parse(z.object({ mute_non_urgent: z.boolean(), categories: z.record(z.boolean()) }), req.body);
  await q(`insert into notification_prefs(user_id, mute_non_urgent, categories) values ($1,$2,$3)
    on conflict (user_id) do update set mute_non_urgent = excluded.mute_non_urgent, categories = excluded.categories`, [req.user!.id, b.mute_non_urgent, JSON.stringify(b.categories)]);
  res.json({ ok: true });
}));

authRouter.put('/profile', requireAuth, h(async (req, res) => {
  const b = parse(z.object({ phone: z.string().max(40).nullable().optional(), share_contact: z.boolean().optional(), email: z.string().trim().email('Escribe un correo válido.').max(200).optional() }), req.body);
  if (b.email && await one('select 1 from users where lower(email) = lower($1) and id <> $2', [b.email, req.user!.id])) throw new HttpError(409, 'Ese correo ya lo usa otra cuenta.');
  await q('update users set phone = coalesce($2, phone), share_contact = coalesce($3, share_contact), email = coalesce(lower($4), email) where id = $1', [req.user!.id, b.phone ?? null, b.share_contact ?? null, b.email ?? null]);
  if (b.email) forgetUser(req.user!.id);
  res.json({ ok: true });
}));

// Exportación de los datos personales del propio usuario (derecho de acceso/portabilidad)
authRouter.get('/export', requireAuth, h(async (req, res) => {
  const id = req.user!.id;
  const data = {
    usuario: await one('select id, name, email, role, phone, share_contact, joined_at, created_at, last_login_at from users where id = $1', [id]),
    asignaciones: await userAssignments(id),
    asistencia: await q('select e.title, e.starts_at, a.status, a.minutes_late, a.note from attendance a join events e on e.id = a.event_id where a.user_id = $1 order by e.starts_at', [id]),
    confirmaciones: await q('select e.title, r.response, r.reason, r.updated_at from event_rsvp r join events e on e.id = r.event_id where r.user_id = $1', [id]),
    anotaciones_personales: await q(`select marcha_id, part_id, page, kind, data, created_at from annotations where owner_id = $1 and layer = 'personal' and not deleted`, [id]),
    dudas: await q('select marcha_id, page, measure, text, visibility, status, created_at from doubts where author_id = $1', [id]),
    progreso_academia: await q('select lesson_id, completed_at, quiz_score from lesson_progress where user_id = $1', [id]),
    ejercicios: await q('select exercise, item, correct, at from exercise_results where user_id = $1 order by at', [id]),
  };
  res.setHeader('Content-Disposition', 'attachment; filename="mis-datos-estrella.json"');
  res.json(data);
}));
