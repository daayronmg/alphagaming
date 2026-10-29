import { useCallback, useEffect, useRef, useState } from 'react';
import { get, api, ApiError } from './api';
import { rt, useRealtime, useChannel } from './realtime';
import { sendOrQueue, pending } from './offline';
import type { Ann, InkStroke } from '../components/ScoreCanvas';

type Action = { type: 'create'; ann: Ann } | { type: 'delete'; ann: Ann } | { type: 'update'; before: Ann; after: Ann };

/**
 * Estado de las capas de anotación de una partitura, sincronizado en tiempo real.
 * - Anotaciones oficiales: llegan por el canal de la marcha (filtradas por público en el servidor).
 * - Personales: solo al propio usuario (todos sus dispositivos); se encolan sin conexión.
 * - Conflictos: control optimista por versión; nunca se sobrescribe en silencio.
 */
export function useAnnotations(marchaId: string | null | undefined, partId: string | null | undefined, opts: { onConflict?: (msg: string) => void; onError?: (msg: string) => void } = {}) {
  const [list, setList] = useState<Ann[]>([]);
  const [ink, setInk] = useState<Record<string, InkStroke>>({});
  const [loaded, setLoaded] = useState(false);
  const since = useRef<string | null>(null);
  const undoStack = useRef<Action[]>([]);
  const redoStack = useRef<Action[]>([]);
  const [, bump] = useState(0);

  useChannel(marchaId ? `marcha:${marchaId}` : null);
  useChannel(partId ? `part:${partId}` : null);

  const relevant = useCallback((a: Ann) => a.marcha_id === marchaId && (!a.part_id || a.part_id === partId), [marchaId, partId]);

  const load = useCallback(async () => {
    if (!marchaId) return;
    const r = await get<{ serverTime: string; annotations: Ann[] }>(`/annotations?marcha=${marchaId}${partId ? `&part=${partId}` : ''}`);
    since.current = r.serverTime;
    // añade lo pendiente de enviar (creado sin conexión)
    const queued = (await pending()).filter((o) => o.path === '/annotations' && o.method === 'POST').map((o) => ({ ...(o.body as any), pending: true, version: 0 } as Ann)).filter(relevant);
    setList([...r.annotations, ...queued.filter((q) => !r.annotations.some((a) => a.id === q.id))]);
    setLoaded(true);
  }, [marchaId, partId, relevant]);

  const catchUp = useCallback(async () => {
    if (!marchaId || !since.current) return load();
    try {
      const r = await get<{ serverTime: string; annotations: Ann[] }>(`/annotations?marcha=${marchaId}${partId ? `&part=${partId}` : ''}&since=${encodeURIComponent(since.current)}`);
      since.current = r.serverTime;
      setList((l) => {
        const map = new Map(l.map((a) => [a.id, a]));
        for (const a of r.annotations) { if (a.deleted) map.delete(a.id); else map.set(a.id, a); }
        return [...map.values()];
      });
    } catch { /* sin conexión */ }
  }, [marchaId, partId, load]);

  useEffect(() => { setLoaded(false); setList([]); load().catch(() => setLoaded(true)); }, [load]);

  useRealtime((m) => {
    if (m.t === 'annotation') {
      const a: Ann = m.annotation;
      if (!relevant(a)) return;
      setList((l) => (m.action === 'delete' ? l.filter((x) => x.id !== a.id) : [...l.filter((x) => x.id !== a.id), a]));
    } else if (m.t === 'ink' && m.partId === partId) {
      setInk((s) => {
        const n = { ...s };
        if (m.done) delete n[m.strokeId]; else n[m.strokeId] = { page: m.page, points: m.points, color: m.color, width: m.width };
        return n;
      });
    } else if (m.t === 'reconnected') catchUp();
  }, [relevant, partId, catchUp]);

  const push = (a: Action) => { undoStack.current.push(a); redoStack.current = []; bump((x) => x + 1); };

  const create = useCallback(async (a: Omit<Ann, 'id' | 'version' | 'owner_id'> & { audience?: any }, record = true) => {
    const id = crypto.randomUUID();
    const body = { id, ...a };
    const optimistic = { ...body, version: 0, owner_id: 'yo', pending: true } as unknown as Ann;
    setList((l) => [...l, optimistic]);
    try {
      const saved = a.layer === 'personal' ? await sendOrQueue<Ann>('/annotations', 'POST', body, 'Anotación personal') : await api<Ann>('/annotations', { method: 'POST', body });
      if (saved) { setList((l) => [...l.filter((x) => x.id !== id), saved]); if (record) push({ type: 'create', ann: saved }); }
      return saved;
    } catch (e) {
      setList((l) => l.filter((x) => x.id !== id));
      opts.onError?.((e as Error).message);
      return null;
    }
  }, [opts.onError]); // eslint-disable-line

  const remove = useCallback(async (ann: Ann, record = true) => {
    setList((l) => l.filter((x) => x.id !== ann.id));
    try {
      await api(`/annotations/${ann.id}?version=${ann.version}`, { method: 'DELETE' });
      if (record) push({ type: 'delete', ann });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { opts.onConflict?.(e.message); if (e.data?.current) setList((l) => [...l.filter((x) => x.id !== ann.id), e.data.current]); }
      else { setList((l) => [...l, ann]); opts.onError?.((e as Error).message); }
    }
  }, [opts.onConflict, opts.onError]); // eslint-disable-line

  const update = useCallback(async (ann: Ann, changes: Partial<Pick<Ann, 'data' | 'color' | 'audience' | 'measure'>>, record = true) => {
    try {
      const saved = await api<Ann>(`/annotations/${ann.id}`, { method: 'PUT', body: { version: ann.version, ...changes } });
      setList((l) => l.map((x) => (x.id === ann.id ? saved : x)));
      if (record) push({ type: 'update', before: ann, after: saved });
      return saved;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // conflicto: se muestra la versión actual y se conserva el cambio local como copia
        const current = e.data?.current as Ann | undefined;
        if (current) setList((l) => l.map((x) => (x.id === ann.id ? current : x)));
        if (ann.layer === 'personal') await create({ ...ann, ...changes, data: { ...(changes.data ?? ann.data) }, layer: 'personal' } as any, false);
        opts.onConflict?.(`${e.message}${ann.layer === 'personal' ? ' Tu cambio se ha guardado como una copia.' : ''}`);
      } else opts.onError?.((e as Error).message);
      return null;
    }
  }, [create, opts.onConflict, opts.onError]); // eslint-disable-line

  const undo = useCallback(async () => {
    const a = undoStack.current.pop();
    if (!a) return;
    if (a.type === 'create') {
      const cur = list.find((x) => x.id === a.ann.id) ?? a.ann;
      await remove(cur, false);
    } else if (a.type === 'delete') {
      try { const r = await api<Ann>(`/annotations/${a.ann.id}/restore`, { method: 'POST', body: {} }); setList((l) => [...l.filter((x) => x.id !== r.id), r]); } catch (e) { opts.onError?.((e as Error).message); }
    } else {
      const cur = list.find((x) => x.id === a.after.id) ?? a.after;
      await update(cur, { data: a.before.data, color: a.before.color }, false);
    }
    redoStack.current.push(a); bump((x) => x + 1);
  }, [list, remove, update]); // eslint-disable-line

  const redo = useCallback(async () => {
    const a = redoStack.current.pop();
    if (!a) return;
    if (a.type === 'create') {
      try { const r = await api<Ann>(`/annotations/${a.ann.id}/restore`, { method: 'POST', body: {} }); setList((l) => [...l.filter((x) => x.id !== r.id), r]); } catch (e) { opts.onError?.((e as Error).message); }
    } else if (a.type === 'delete') {
      const cur = list.find((x) => x.id === a.ann.id) ?? a.ann;
      await remove(cur, false);
    } else {
      const cur = list.find((x) => x.id === a.before.id) ?? a.before;
      await update(cur, { data: a.after.data, color: a.after.color }, false);
    }
    undoStack.current.push(a); bump((x) => x + 1);
  }, [list, remove, update]); // eslint-disable-line

  const sendInk = useCallback((s: { strokeId: string; page: number; points: [number, number][]; color: string; width: number; done: boolean }) => {
    rt.send({ t: 'ink', partId, ...s });
  }, [partId]);

  return { list, ink, loaded, create, update, remove, undo, redo, canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0, reload: load, sendInk };
}
