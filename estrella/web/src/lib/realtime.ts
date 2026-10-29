// Cliente de tiempo real: reconexión automática, resuscripción, sincronización de reloj con el servidor.
import { useEffect, useState, useSyncExternalStore } from 'react';

export type ConnStatus = 'conectado' | 'conectando' | 'desconectado';
type Listener = (msg: any) => void;

export function deviceId(): string {
  let id = localStorage.getItem('estrella.device');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('estrella.device', id); }
  return id;
}
function deviceLabel() {
  const ua = navigator.userAgent;
  const kind = /iPad|Tablet/i.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document) ? 'Tableta' : /Mobi|Android|iPhone/i.test(ua) ? 'Móvil' : 'Ordenador';
  return kind;
}

class Realtime {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<() => void>();
  private channels = new Map<string, number>();
  private retry = 0;
  private timer: number | null = null;
  private syncTimer: number | null = null;
  private wanted = false;
  private everConnected = false;
  status: ConnStatus = 'desconectado';
  /** desfase estimado: horaServidor ≈ Date.now() + offset */
  offset = 0;
  rtt = 0;
  private samples: { offset: number; rtt: number }[] = [];

  start() {
    if (this.wanted) return;
    this.wanted = true;
    this.open();
    window.addEventListener('online', () => this.kick());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.kick(); });
  }
  stop() {
    this.wanted = false;
    this.ws?.close();
    this.ws = null;
    this.setStatus('desconectado');
  }
  private kick() {
    if (!this.wanted) return;
    if (!this.ws || this.ws.readyState > 1) { this.retry = 0; this.open(); }
  }
  private setStatus(s: ConnStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((l) => l());
  }
  private open() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.setStatus('conectando');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('conectado');
      ws.send(JSON.stringify({ t: 'hello', deviceId: deviceId(), label: deviceLabel() }));
      for (const ch of this.channels.keys()) ws.send(JSON.stringify({ t: 'sub', ch }));
      this.syncClock();
      if (this.syncTimer) clearInterval(this.syncTimer);
      this.syncTimer = window.setInterval(() => this.syncClock(), 30_000);
      if (this.everConnected) this.emit({ t: 'reconnected' });
      this.everConnected = true;
    };
    ws.onmessage = (ev) => {
      let m: any;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'pong') {
        const now = Date.now();
        const rtt = now - m.c;
        this.samples.push({ rtt, offset: m.s - (m.c + rtt / 2) });
        this.samples = this.samples.slice(-12);
        // la muestra con menor latencia es la más fiable
        const best = [...this.samples].sort((a, b) => a.rtt - b.rtt)[0];
        this.offset = best.offset; this.rtt = best.rtt;
        return;
      }
      this.emit(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.syncTimer) clearInterval(this.syncTimer);
      this.setStatus('desconectado');
      if (!this.wanted) return;
      const delay = Math.min(10_000, 400 * 2 ** this.retry++) * (0.7 + Math.random() * 0.6);
      this.timer = window.setTimeout(() => this.open(), delay);
    };
    ws.onerror = () => ws.close();
  }
  private syncClock() {
    for (let i = 0; i < 5; i++) setTimeout(() => this.send({ t: 'ping', c: Date.now() }), i * 120);
  }
  serverNow() { return Date.now() + this.offset; }
  send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) { this.ws.send(JSON.stringify(msg)); return true; }
    return false;
  }
  private emit(m: any) { this.listeners.forEach((l) => { try { l(m); } catch (e) { console.error(e); } }); }
  on(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  subscribe(ch: string) {
    this.channels.set(ch, (this.channels.get(ch) ?? 0) + 1);
    if (this.channels.get(ch) === 1) this.send({ t: 'sub', ch });
    return () => {
      const n = (this.channels.get(ch) ?? 1) - 1;
      if (n <= 0) { this.channels.delete(ch); this.send({ t: 'unsub', ch }); } else this.channels.set(ch, n);
    };
  }
  onStatus(fn: () => void) { this.statusListeners.add(fn); return () => { this.statusListeners.delete(fn); }; }
}

export const rt = new Realtime();

export function useConn(): ConnStatus {
  return useSyncExternalStore((cb) => rt.onStatus(cb), () => rt.status);
}
/** Escucha mensajes en tiempo real (el handler se mantiene actualizado sin resuscribir). */
export function useRealtime(handler: Listener, deps: unknown[] = []) {
  useEffect(() => rt.on(handler), deps); // eslint-disable-line react-hooks/exhaustive-deps
}
export function useChannel(ch: string | null | undefined) {
  useEffect(() => (ch ? rt.subscribe(ch) : undefined), [ch]);
}
/** Fuerza el re-render periódico (relojes, posición de reproducción). */
export function useTick(ms: number, active = true) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms, active]);
}
