import { useCallback, useEffect, useRef, useState } from 'react';
import { get, post } from './api';
import { rt, useChannel, useRealtime, useConn } from './realtime';

export interface LiveState {
  marchaId: string | null; marchaTitle: string | null; measure: number; totalMeasures: number | null;
  section: { name: string; from: number; to: number | null } | null; loop: { from: number; to: number } | null;
  transport: { status: 'stopped' | 'playing' | 'paused'; anchorTs: number; anchorMeasure: number };
  tempo: number; beatsPerMeasure: number; metronome: boolean; follow: boolean; silent: boolean; showAnnotations: boolean;
  view: 'auto' | 'pdf' | 'score'; highlight: { measure: number; noteId?: string | null } | null;
  messages: { id: string; text: string; at: number; audience: any }[]; planItemId: string | null; lastCommand: { type: string; at: number; by: string } | null;
}

/** Posición musical (compás fraccionario) en un instante del reloj del servidor. */
export function positionAt(s: LiveState, serverTs: number): number {
  const t = s.transport;
  if (t.status !== 'playing') return t.anchorMeasure;
  if (serverTs < t.anchorTs) return t.anchorMeasure; // cuenta atrás hasta el arranque programado
  let pos = t.anchorMeasure + ((serverTs - t.anchorTs) / 1000) * (s.tempo / 60) / s.beatsPerMeasure;
  if (s.loop && pos >= s.loop.to + 1) { const len = s.loop.to + 1 - s.loop.from; pos = s.loop.from + ((pos - s.loop.from) % len); }
  if (s.totalMeasures && pos >= s.totalMeasures + 1) pos = s.totalMeasures + 0.999;
  return pos;
}

/**
 * Sesión en directo: estado compartido guardado en el servidor + órdenes en tiempo real.
 * - Al conectar o reconectar se recupera el estado completo (no depende de haber recibido cada mensaje).
 * - Las órdenes llevan número de versión: se ignoran las antiguas que lleguen desordenadas.
 * - Se informa al servidor del estado del dispositivo (sincronizado/sincronizando) y de órdenes recibidas tarde.
 */
export function useLiveSession(id: string | null | undefined, partId?: string | null) {
  const [state, setState] = useState<LiveState | null>(null);
  const [version, setVersion] = useState(0);
  const [session, setSession] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [lateMs, setLateMs] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(true);
  const versionRef = useRef(0);
  const conn = useConn();
  useChannel(id ? `live:${id}` : null);

  const report = useCallback((status: 'sincronizado' | 'sincronizando', late?: number) => {
    if (!id) return;
    rt.send({ t: 'live:status', sessionId: id, status, version: versionRef.current, partId: partId ?? null, lagMs: Math.round(rt.rtt / 2), ...(late ? { late } : {}) });
  }, [id, partId]);

  const fetchState = useCallback(async () => {
    if (!id) return;
    setSyncing(true); report('sincronizando');
    try {
      const r = await get(`/live/${id}`);
      setSession(r);
      if (!r.active) setEnded(true);
      if (r.version >= versionRef.current) { versionRef.current = r.version; setVersion(r.version); setState(r.state); }
      setError(null);
    } catch (e) { setError((e as Error).message); } finally { setSyncing(false); report('sincronizado'); }
  }, [id, report]);

  useEffect(() => { versionRef.current = 0; setState(null); setEnded(false); fetchState(); }, [id]); // eslint-disable-line
  useEffect(() => { if (conn === 'conectado') fetchState(); else setSyncing(true); }, [conn]); // eslint-disable-line
  useEffect(() => { report('sincronizado'); }, [partId]); // eslint-disable-line
  useEffect(() => () => { rt.send({ t: 'live:leave' }); }, [id]);

  useRealtime((m) => {
    if (m.sessionId !== id) return;
    if (m.t === 'live:state') {
      if (m.version <= versionRef.current) return; // orden antigua o duplicada
      if (m.version > versionRef.current + 1) { fetchState(); return; } // se ha perdido alguna orden: recuperar estado completo
      versionRef.current = m.version; setVersion(m.version); setState(m.state);
      const now = rt.serverNow();
      const late = m.state.transport.status === 'playing' && now > m.state.transport.anchorTs ? Math.round(now - m.state.transport.anchorTs) : null;
      setLateMs(late);
      report('sincronizado', late ?? undefined);
    } else if (m.t === 'live:ended') setEnded(true);
  }, [id, fetchState, report]);

  return { state, version, session, error, ended, lateMs, syncing: syncing || conn !== 'conectado', reload: fetchState };
}

export async function liveCmd(id: string, cmd: object) {
  return post(`/live/${id}/cmd`, cmd);
}

export function audienceMatches(aud: any, sectionIds: number[], isDirector: boolean) {
  if (!aud || aud.scope === 'all') return true;
  return isDirector || aud.sections.some((s: number) => sectionIds.includes(s));
}
