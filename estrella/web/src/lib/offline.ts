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
