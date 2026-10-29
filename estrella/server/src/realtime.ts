import type http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from './config.ts';
import { COOKIE, userFromToken, can, isStaff, type AuthUser } from './lib/auth.ts';
import { q } from './db.ts';

export interface Client {
  ws: WebSocket;
  user: AuthUser;
  deviceId: string;
  label: string;
  channels: Set<string>;
  alive: boolean;
  live?: { sessionId: string; status: string; version: number; partId?: string | null; lagMs?: number; at: number };
}

type Filter = (c: Client) => boolean;

interface Presence {
  userId: string; name: string; deviceId: string; label: string;
  status: 'sincronizado' | 'sincronizando' | 'desconectado';
  version: number; partId?: string | null; lagMs?: number; lastSeen: number;
}

class Hub {
  clients = new Set<Client>();
  /** presencia por sesión en directo (incluye dispositivos desconectados recientemente) */
  presence = new Map<string, Map<string, Presence>>();
  liveVersions = new Map<string, number>();
  private presenceTimers = new Map<string, NodeJS.Timeout>();

  publish(channel: string, msg: object, filter?: Filter) {
    const data = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.channels.has(channel) && c.ws.readyState === WebSocket.OPEN && (!filter || filter(c))) c.ws.send(data);
    }
  }
  toUser(userId: string, msg: object) { this.publish(`user:${userId}`, msg); }
  toAll(msg: object, filter?: Filter) { this.publish('band', msg, filter); }
  toStaff(msg: object) { this.publish('staff', msg); }

  setLiveVersion(sessionId: string, v: number) {
    this.liveVersions.set(sessionId, v);
    // los dispositivos con versión anterior pasan a 'sincronizando' hasta que confirmen
    const p = this.presence.get(sessionId);
    if (p) for (const d of p.values()) if (d.status !== 'desconectado' && d.version < v) d.status = 'sincronizando';
    this.schedulePresence(sessionId);
  }

  updatePresence(c: Client, connected: boolean) {
    if (!c.live) return;
    const sid = c.live.sessionId;
    if (!this.presence.has(sid)) this.presence.set(sid, new Map());
    const map = this.presence.get(sid)!;
    const current = this.liveVersions.get(sid) ?? 0;
    const prev = map.get(c.deviceId);
    map.set(c.deviceId, {
      userId: c.user.id, name: c.user.name, deviceId: c.deviceId, label: c.label,
      status: !connected ? 'desconectado' : c.live.version >= current && c.live.status === 'sincronizado' ? 'sincronizado' : 'sincronizando',
      version: c.live.version, partId: c.live.partId, lagMs: c.live.lagMs, lastSeen: Date.now(),
    });
    if (!prev || (prev.status === 'desconectado') !== !connected) {
      q('insert into live_device_log(session_id, user_id, device_id, kind, detail) values ($1,$2,$3,$4,$5)',
        [sid, c.user.id, c.deviceId, connected ? 'connect' : 'disconnect', JSON.stringify({ label: c.label })]).catch(() => {});
    }
    this.schedulePresence(sid);
  }

  presenceList(sessionId: string): Presence[] {
    const map = this.presence.get(sessionId);
    if (!map) return [];
    const now = Date.now();
    for (const [k, p] of map) if (p.status === 'desconectado' && now - p.lastSeen > 30 * 60_000) map.delete(k);
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  schedulePresence(sessionId: string) {
    if (this.presenceTimers.has(sessionId)) return;
    this.presenceTimers.set(sessionId, setTimeout(() => {
      this.presenceTimers.delete(sessionId);
      this.publish(`live:${sessionId}`, { t: 'live:presence', sessionId, devices: this.presenceList(sessionId) }, (c) => can(c.user, 'live.direct') || isStaff(c.user));
    }, 250));
  }
}

export const hub = new Hub();

function canSubscribe(user: AuthUser, ch: string): boolean {
  if (ch === 'staff') return isStaff(user);
  if (ch === `user:${user.id}` || ch === 'band') return true;
  return /^(live|part|score|marcha|event):[0-9a-f-]{36}$/.test(ch);
}

function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true; // clientes no-navegador (pruebas)
  try {
    const o = new URL(origin);
    if (host && o.host === host) return true;
    if (o.origin === new URL(config.publicUrl).origin) return true;
    return !config.production && (o.hostname === 'localhost' || o.hostname === '127.0.0.1');
  } catch { return false; }
}

export function attachRealtime(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });

  server.on('upgrade', async (req, socket, head) => {
    if (!req.url?.startsWith('/ws')) return socket.destroy();
    if (!originAllowed(req.headers.origin, req.headers.host)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); }
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map((p) => p.trim().split('=').map(decodeURIComponent)).filter((p) => p.length === 2));
    const auth = await userFromToken(cookies[COOKIE]).catch(() => undefined);
    if (!auth) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const c: Client = { ws, user: auth.user, deviceId: 'anon', label: '', channels: new Set([`user:${auth.user.id}`, 'band']), alive: true };
      if (isStaff(auth.user)) c.channels.add('staff');
      hub.clients.add(c);
      ws.on('pong', () => (c.alive = true));
      ws.on('message', (raw) => {
        let m: any;
        try { m = JSON.parse(raw.toString()); } catch { return; }
        handleMessage(c, m);
      });
      ws.on('close', () => {
        hub.clients.delete(c);
        if (c.live && ![...hub.clients].some((o) => o.deviceId === c.deviceId && o.live?.sessionId === c.live?.sessionId)) hub.updatePresence(c, false);
      });
      ws.send(JSON.stringify({ t: 'welcome', s: Date.now(), userId: auth.user.id }));
    });
  });

  const iv = setInterval(() => {
    for (const c of hub.clients) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false;
      c.ws.ping();
    }
  }, 15_000);
  wss.on('close', () => clearInterval(iv));
  return wss;
}

function handleMessage(c: Client, m: any) {
  switch (m?.t) {
    case 'ping':
      // sincronización de reloj tipo NTP: el cliente calcula desfase y latencia
      c.ws.send(JSON.stringify({ t: 'pong', c: m.c, s: Date.now() }));
      break;
    case 'hello':
      c.deviceId = String(m.deviceId || 'anon').slice(0, 64);
      c.label = String(m.label || '').slice(0, 80);
      break;
    case 'sub':
      if (typeof m.ch === 'string' && canSubscribe(c.user, m.ch)) c.channels.add(m.ch);
      break;
    case 'unsub':
      if (typeof m.ch === 'string' && !m.ch.startsWith('user:')) c.channels.delete(m.ch);
      break;
    case 'live:status': {
      if (typeof m.sessionId !== 'string') return;
      const prevSid = c.live?.sessionId;
      c.live = { sessionId: m.sessionId, status: m.status === 'sincronizado' ? 'sincronizado' : 'sincronizando', version: Number(m.version) || 0, partId: m.partId ?? null, lagMs: Number(m.lagMs) || undefined, at: Date.now() };
      if (prevSid && prevSid !== m.sessionId) {
        const old = hub.presence.get(prevSid)?.get(c.deviceId);
        if (old) { old.status = 'desconectado'; hub.schedulePresence(prevSid); }
      }
      if (m.late) {
        q('insert into live_device_log(session_id, user_id, device_id, kind, detail) values ($1,$2,$3,$4,$5)',
          [m.sessionId, c.user.id, c.deviceId, 'late_command', JSON.stringify({ lateMs: Number(m.late) })]).catch(() => {});
      }
      hub.updatePresence(c, true);
      break;
    }
    case 'live:leave':
      if (c.live) { hub.updatePresence(c, false); c.live = undefined; }
      break;
    case 'ink': {
      // trazo en curso del director (efímero): se reenvía al instante; al soltar el lápiz se guarda por HTTP
      if (typeof m.partId !== 'string' && typeof m.marchaId !== 'string') return;
      if (!can(c.user, 'annotate.official') && !c.user.leaderOf.some((l) => l.permissions.includes('annotate'))) return;
      const payload = { t: 'ink', from: c.user.id, strokeId: String(m.strokeId).slice(0, 64), page: Number(m.page), color: String(m.color).slice(0, 16), width: Number(m.width) || 3, points: Array.isArray(m.points) ? m.points.slice(0, 400) : [], done: !!m.done, partId: m.partId, marchaId: m.marchaId };
      const ch = m.marchaId ? `marcha:${m.marchaId}` : `part:${m.partId}`;
      hub.publish(ch, payload, (o) => o !== c);
      break;
    }
  }
}
