// Cola de cambios sin conexión (IndexedDB). Las operaciones son idempotentes (identificadores únicos generados en el cliente).
import { api, ApiError } from './api';
import { rt } from './realtime';

type Op = { id: string; path: string; method: string; body: unknown; at: number; label: string };
const DB = 'estrella-offline';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('outbox', { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('outbox', mode);
    const req = fn(t.objectStore('outbox'));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const listeners = new Set<(n: number) => void>();
export function onOutbox(fn: (n: number) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
async function notify() { const n = (await pending()).length; listeners.forEach((l) => l(n)); }

export async function pending(): Promise<Op[]> {
  try { return (await tx<Op[]>('readonly', (s) => s.getAll() as IDBRequest<Op[]>)).sort((a, b) => a.at - b.at); } catch { return []; }
}

/** Ejecuta la petición; si no hay red, la guarda para reenviarla al reconectar. */
export async function sendOrQueue<T = any>(path: string, method: string, body: unknown, label: string): Promise<T | null> {
  try {
    return await api<T>(path, { method, body });
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      await tx('readwrite', (s) => s.put({ id: crypto.randomUUID(), path, method, body, at: Date.now(), label }));
      notify();
      return null;
    }
    throw e;
  }
}

let flushing = false;
export async function flush(): Promise<{ sent: number; conflicts: string[] }> {
  if (flushing) return { sent: 0, conflicts: [] };
  flushing = true;
  const conflicts: string[] = [];
  let sent = 0;
  try {
    for (const op of await pending()) {
      try {
        await api(op.path, { method: op.method, body: op.body });
        sent++;
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) break; // sigue sin red
        // conflicto u otro error: no se pierde en silencio, se informa
        conflicts.push(`${op.label}: ${(e as Error).message}`);
      }
      await tx('readwrite', (s) => s.delete(op.id));
    }
  } finally { flushing = false; notify(); }
  return { sent, conflicts };
}

rt.on((m) => { if (m.t === 'reconnected' || m.t === 'welcome') flush(); });
window.addEventListener('online', () => flush());

/** Agenda: un año atrás y otro adelante, contado desde hoy a las 00:00 (la misma dirección todo el día, así sirve la copia sin conexión). */
export function agendaUrl(): string {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const from = new Date(d); from.setDate(from.getDate() - 366);
  const to = new Date(d); to.setDate(to.getDate() + 366);
  return `/events?from=${from.toISOString()}&to=${to.toISOString()}`;
}

/**
 * Deja en el móvil todo lo necesario para tocar sin cobertura (procesiones, ensayos sin wifi):
 * la lista de marchas, la agenda y, de cada marcha, sus datos, las notas de tu voz y el PDF de tu parte.
 * Lo guarda el propio navegador (service worker), así que después se abre igual sin conexión.
 */
export async function downloadForOffline(onProgress: (done: number, total: number) => void): Promise<{ ok: number; total: number }> {
  const files = new Set<string>();
  const list = await api<any[]>('/library/marchas');
  await Promise.all([api(agendaUrl()).catch(() => null), api('/events').catch(() => null), api('/auth/me').catch(() => null), fetch('/sounds/corneta.mp3').catch(() => null)]);
  let done = 0, ok = 0;
  const total = list.length;
  onProgress(0, total);
  const one = async (m: any) => {
    try {
      const d = await api<any>(`/library/marchas/${m.id}/play`);
      const sid = d.mine?.score?.id ?? (!d.mine?.assignment ? d.scores?.find((s: any) => s.published_version_id)?.id : null);
      if (sid) await api(`/scores/${sid}?light=1`);
      const part = d.mine?.part;
      if (part) {
        await api(`/library/parts/${part.id}`).catch(() => null);
        if (!files.has(part.file_id)) { files.add(part.file_id); await fetch(`/api/files/${part.file_id}`, { credentials: 'same-origin' }).then((r) => r.blob()); }
      }
      ok++;
    } catch { /* esa marcha queda sin descargar */ }
    onProgress(++done, total);
  };
  // de 4 en 4 para no saturar el móvil
  for (let i = 0; i < list.length; i += 4) await Promise.all(list.slice(i, i + 4).map(one));
  try { localStorage.setItem('estrella.offlineAt', new Date().toISOString()); } catch { /* sin almacenamiento */ }
  return { ok, total };
}
export function offlineSavedAt(): Date | null {
  try { const v = localStorage.getItem('estrella.offlineAt'); return v ? new Date(v) : null; } catch { return null; }
}
