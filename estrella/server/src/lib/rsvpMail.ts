/**
 * Convocatoria por correo: al programar un ensayo o actuación, a cada componente convocado le llega un correo
 * con el día, la hora y el lugar, y dos botones («Voy» / «No voy»). Cada botón es un enlace firmado para ese
 * componente y ese evento, así que confirma sin iniciar sesión. El enlace abre una página con el botón de
 * confirmar (no confirma al abrirlo: los antivirus de correo visitan los enlaces solos).
 */
import crypto from 'node:crypto';
import express, { Router } from 'express';
import { q, one } from '../db.ts';
import { config } from '../config.ts';
import { sendMail } from './mail.ts';
import { hub } from '../realtime.ts';
import { convokedMembers } from '../routes/events.ts';

type Resp = 'asistire' | 'no_asistire';

let secret: Buffer | null = null;
/** Clave para firmar los enlaces: la del entorno o una aleatoria que se guarda una vez en la base de datos. */
async function linkSecret(): Promise<Buffer> {
  if (secret) return secret;
  if (process.env.LINK_SECRET) return (secret = Buffer.from(process.env.LINK_SECRET));
  const fresh = crypto.randomBytes(32).toString('hex');
  await q(`insert into settings(key, value) values ('link_secret', $1) on conflict (key) do nothing`, [JSON.stringify(fresh)]);
  const row = await one<any>(`select value from settings where key = 'link_secret'`);
  return (secret = Buffer.from(String(row.value)));
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
export async function rsvpToken(eventId: string, userId: string, response: Resp) {
  const body = b64(`${eventId}.${userId}.${response === 'asistire' ? 's' : 'n'}`);
  const sig = crypto.createHmac('sha256', await linkSecret()).update(body).digest('base64url').slice(0, 32);
  return `${body}.${sig}`;
}
async function readToken(token: string): Promise<{ eventId: string; userId: string; response: Resp } | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const good = crypto.createHmac('sha256', await linkSecret()).update(body).digest('base64url').slice(0, 32);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const [eventId, userId, r] = Buffer.from(body, 'base64url').toString().split('.');
  return eventId && userId ? { eventId, userId, response: r === 's' ? 'asistire' : 'no_asistire' } : null;
}

const TZ = 'Europe/Madrid';
const fmtDay = (d: Date) => d.toLocaleDateString('es-ES', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const fmtTime = (d: Date) => d.toLocaleTimeString('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
// cuentas sin correo real (las que entran con el teléfono) y las de prueba
const realEmail = (e: string) => !/@sin-correo\.|\.demo$|@example\./i.test(e);

/** Manda la convocatoria a cada componente convocado con correo. Devuelve cuántos se enviaron. */
export async function sendRsvpInvites(eventId: string): Promise<number> {
  const e = await one<any>(`select id, type, title, starts_at, call_at, location, uniform, notes, status from events where id = $1`, [eventId]);
  if (!e || e.status !== 'programado' || new Date(e.starts_at) < new Date()) return 0;
  const members = await convokedMembers(eventId);
  const users = await q<any>(`select id, name, email from users where id = any($1) and status = 'active'`, [members.map((m) => m.id)]);
  const start = new Date(e.starts_at);
  const day = fmtDay(start);
  const when = e.call_at ? `citación a las ${fmtTime(new Date(e.call_at))}` : `a las ${fmtTime(start)}`;
  let sent = 0;
  for (const u of users.filter((x) => realEmail(x.email))) {
    const yes = `${config.publicUrl}/api/rsvp/${await rsvpToken(e.id, u.id, 'asistire')}`;
    const no = `${config.publicUrl}/api/rsvp/${await rsvpToken(e.id, u.id, 'no_asistire')}`;
    const first = u.name.split(' ')[0];
    const text = `Hola ${first}:\n\n${e.title}\n${day}, ${when}${e.location ? `\nLugar: ${e.location}` : ''}${e.uniform ? `\nUniformidad: ${e.uniform}` : ''}${e.notes ? `\n\n${e.notes}` : ''}\n\n¿Vas?\n· Voy: ${yes}\n· No voy: ${no}\n\nTambién puedes responder desde ${config.publicUrl}\n`;
    const html = mailHtml({ first, title: e.title, day, when, location: e.location, uniform: e.uniform, notes: e.notes, yes, no });
    if (await sendMail(u.email, `${e.title} · ${day}`, text, html)) sent++;
  }
  if (sent) console.log(`[convocatoria] ${e.title}: ${sent} correos enviados`);
  return sent;
}

function mailHtml(p: { first: string; title: string; day: string; when: string; location?: string; uniform?: string; notes?: string; yes: string; no: string }) {
  const row = (k: string, v?: string) => (v ? `<tr><td style="padding:4px 12px 4px 0;color:#6b6b6b">${k}</td><td style="padding:4px 0;font-weight:600">${esc(v)}</td></tr>` : '');
  const btn = (href: string, label: string, dark: boolean) =>
    `<a href="${href}" style="display:inline-block;padding:14px 26px;margin:6px 8px 6px 0;border-radius:999px;font-weight:700;font-size:16px;text-decoration:none;${dark ? 'background:#0a0a0a;color:#fff' : 'background:#f1efec;color:#0a0a0a;border:1px solid #e1ddd7'}">${label}</a>`;
  return `<!doctype html><html><body style="margin:0;background:#f5f4f1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a">
<div style="max-width:520px;margin:0 auto;padding:28px 16px">
  <div style="text-align:center;margin-bottom:18px"><img src="${config.publicUrl}/logo-256.webp" width="72" height="72" alt="" style="display:inline-block"><div style="font-weight:800;letter-spacing:-.5px;font-size:18px;margin-top:6px">${esc(config.appName)}</div></div>
  <div style="background:#fff;border:1px solid #e6e3de;border-radius:20px;padding:24px">
    <p style="margin:0 0 6px;color:#6b6b6b">Hola ${esc(p.first)}, la dirección ha programado:</p>
    <h1 style="margin:0 0 14px;font-size:24px;letter-spacing:-.5px">${esc(p.title)}</h1>
    <table style="border-collapse:collapse;font-size:15px">${row('Día', p.day)}${row('Hora', p.when)}${row('Lugar', p.location)}${row('Uniformidad', p.uniform)}</table>
    ${p.notes ? `<p style="margin:14px 0 0;font-size:14px;color:#444;white-space:pre-line">${esc(p.notes)}</p>` : ''}
    <p style="margin:22px 0 6px;font-weight:700">¿Vas?</p>
    ${btn(p.yes, '✓ Voy', true)}${btn(p.no, '✕ No voy', false)}
  </div>
  <p style="text-align:center;font-size:12px;color:#8a867f;margin-top:16px">También puedes responder desde <a href="${config.publicUrl}" style="color:#8a867f">${esc(config.publicUrl.replace(/^https?:\/\//, ''))}</a></p>
</div></body></html>`;
}

// ===== Página que abren los botones del correo =====
const REASONS = ['Trabajo', 'Estoy enfermo/a', 'Estudios', 'Viaje', 'Asunto familiar'];

function page(title: string, body: string) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · ${esc(config.appName)}</title><style>
body{margin:0;background:#f5f4f1;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0a0a0a}
main{max-width:460px;margin:0 auto;padding:32px 16px;text-align:center}.card{background:#fff;border:1px solid #e6e3de;border-radius:22px;padding:26px;text-align:left}
h1{font-size:24px;letter-spacing:-.5px;margin:0 0 6px}p{color:#555;line-height:1.45}button,.btn{display:block;width:100%;box-sizing:border-box;padding:15px;border-radius:999px;border:0;font-size:17px;font-weight:700;margin-top:12px;cursor:pointer;text-align:center;text-decoration:none}
.dark{background:#0a0a0a;color:#fff}.light{background:#f1efec;color:#0a0a0a;border:1px solid #e1ddd7}label{display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid #f0ede8;font-size:16px}
input[type=text]{width:100%;box-sizing:border-box;padding:12px;border:1px solid #d9d5cf;border-radius:12px;font-size:16px;margin-top:10px}</style></head>
<body><main><img src="/logo-256.webp" width="64" height="64" alt=""><div class="card">${body}</div></main></body></html>`;
}

async function load(token: string) {
  const t = await readToken(token);
  if (!t) return null;
  const e = await one<any>(`select id, title, starts_at, call_at, location, status from events where id = $1`, [t.eventId]);
  const u = await one<any>(`select id, name from users where id = $1 and status = 'active'`, [t.userId]);
  return e && u ? { t, e, u } : null;
}

const invalid = page('Enlace no válido', `<h1>Enlace no válido</h1><p>Este enlace no es correcto o ha caducado. Responde desde la app.</p><a class="btn dark" href="/">Abrir la app</a>`);
const closed = page('Ya no se puede responder', `<h1>Ya no se puede responder</h1><p>Este ensayo ya no admite confirmaciones.</p><a class="btn dark" href="/">Abrir la app</a>`);

export const rsvpLinkRouter = Router();
rsvpLinkRouter.use(express.urlencoded({ extended: false, limit: '4kb' }));
rsvpLinkRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

rsvpLinkRouter.get('/:token', async (req, res) => {
  const x = await load(req.params.token);
  if (!x) return res.status(404).send(invalid);
  if (x.e.status !== 'programado') return res.send(closed);
  const start = new Date(x.e.starts_at);
  const head = `<p style="margin:0">Hola ${esc(x.u.name.split(' ')[0])}</p><h1>${esc(x.e.title)}</h1><p style="margin-top:0">${fmtDay(start)} · ${x.e.call_at ? `citación ${fmtTime(new Date(x.e.call_at))}` : fmtTime(start)}${x.e.location ? ` · ${esc(x.e.location)}` : ''}</p>`;
  if (x.t.response === 'asistire') {
    return res.send(page('¿Vas?', `${head}<form method="post"><button class="dark">✓ Sí, voy</button></form>`));
  }
  res.send(page('¿Por qué no puedes ir?', `${head}<form method="post"><p style="font-weight:700;color:#0a0a0a;margin-bottom:4px">¿Por qué no puedes ir?</p>
${REASONS.map((r, i) => `<label><input type="radio" name="reason" value="${esc(r)}"${i === 0 ? ' required' : ''}> ${esc(r)}</label>`).join('')}
<label><input type="radio" name="reason" value="otro"> Otro motivo</label><input type="text" name="other" maxlength="300" placeholder="Escribe el motivo (si es otro)">
<button class="dark">Enviar: no voy</button></form>`));
});

rsvpLinkRouter.post('/:token', async (req, res) => {
  const x = await load(req.params.token);
  if (!x) return res.status(404).send(invalid);
  if (x.e.status !== 'programado') return res.send(closed);
  let reason: string | null = null;
  if (x.t.response === 'no_asistire') {
    const r = String(req.body?.reason ?? '').trim();
    reason = (r === 'otro' ? String(req.body?.other ?? '').trim() : r).slice(0, 300);
    if (!reason) return res.status(400).send(page('Falta el motivo', `<h1>Falta el motivo</h1><p>Vuelve atrás e indica por qué no puedes ir.</p>`));
  }
  await q(`insert into event_rsvp(event_id, user_id, response, reason) values ($1,$2,$3,$4)
    on conflict (event_id, user_id) do update set response = excluded.response, reason = excluded.reason, updated_at = now()`, [x.e.id, x.u.id, x.t.response, reason]);
  hub.toStaff({ t: 'rsvp', eventId: x.e.id, userId: x.u.id, response: x.t.response });
  res.send(page('¡Apuntado!', x.t.response === 'asistire'
    ? `<h1>¡Apuntado! ✓</h1><p>Has confirmado que vas a <b>${esc(x.e.title)}</b>. Te esperamos.</p><a class="btn light" href="/">Abrir la app</a>`
    : `<h1>Recibido</h1><p>La dirección ya sabe que no puedes ir a <b>${esc(x.e.title)}</b> (${esc(reason!)}).</p><a class="btn light" href="/">Abrir la app</a>`));
});
