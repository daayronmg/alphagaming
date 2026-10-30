import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Radio, Search, Play, Square, Users, Pencil, Eye, SlidersHorizontal, Check } from '../components/icons';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Spinner, Notice, useToast } from '../components/ui';
import { useLiveSession, liveCmd } from '../lib/live';
import { useRealtime } from '../lib/realtime';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Dirigir un ensayo de forma sencilla: empezar, tocar una marcha de la lista para que a todos
 * les salga al momento, ver quién está conectado, corregir notas y terminar.
 */
export default function DirectorSimple() {
  const { can } = useAuth();
  const toast = useToast();
  const active = useLoad(() => get<any[]>('/live/active'), []);
  const events = useLoad(() => get<any[]>(`/events?from=${new Date(Date.now() - 6 * 3600_000).toISOString()}`), []);
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { setId(active.data?.[0]?.id ?? null); }, [active.data]);
  if (!can('live.direct')) return <div className="page"><Notice kind="danger">Solo la dirección puede dirigir el ensayo.</Notice></div>;
  if (active.loading && !active.data) return <Spinner />;

  const start = async () => {
    // si hay un ensayo programado para hoy, el directo queda vinculado a él (asistencia y repertorio trabajado)
    const today = (events.data ?? []).find((e) => e.status === 'programado' && new Date(e.starts_at).toDateString() === new Date().toDateString());
    try { const r = await post('/live', { event_id: today?.id ?? null }); setId(r.id); toast({ kind: 'ok', text: 'Ensayo empezado: a los músicos ya les sale la pantalla del directo.' }); }
    catch (e) { toast({ kind: 'error', text: (e as Error).message }); }
  };

  if (!id) {
    return (
      <div className="page stack lg" style={{ maxWidth: 720 }}>
        <div><div className="eyebrow">Dirección musical</div><h1>Dirigir ensayo</h1></div>
        <div className="card stack" style={{ alignItems: 'center', textAlign: 'center', padding: 32 }}>
          <span className="live-pulse"><Radio size={34} /></span>
          <p className="muted">Al empezar, a todos los músicos conectados les sale la pantalla del ensayo. Después solo tienes que tocar la marcha que quieras.</p>
          <button className="btn lg primary play-big" onClick={start} data-testid="start-live"><Play size={22} /> Empezar ensayo</button>
        </div>
      </div>
    );
  }
  return <Directing id={id} onEnd={() => { setId(null); active.reload(); }} />;
}

function Directing({ id, onEnd }: { id: string; onEnd: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const live = useLiveSession(id);
  const s = live.state;
  const marchas = useLoad(() => get<any[]>('/library/marchas'), []);
  const presence = useLoad(() => get<any[]>(`/live/${id}/presence`).catch(() => []), [id]);
  const current = useLoad(() => (s?.marchaId ? get(`/library/marchas/${s.marchaId}`) : Promise.resolve(null)), [s?.marchaId]);
  const [q, setQ] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [devices, setDevices] = useState<any[] | null>(null);
  useRealtime((m) => { if (m.t === 'live:presence' && m.sessionId === id) setDevices(m.devices); }, [id]);
  useEffect(() => { const t = setInterval(() => presence.reload(), 10_000); return () => clearInterval(t); }, []); // eslint-disable-line

  const list = (marchas.data ?? []).filter((m) => !m.is_demo || (marchas.data ?? []).every((x) => x.is_demo))
    .filter((m) => !q || norm(m.title).includes(norm(q)) || norm(m.composer ?? '').includes(norm(q)));
  const all = devices ?? (Array.isArray(presence.data) ? presence.data : []);
  const people = [...new Set(all.filter((p: any) => p.status !== 'desconectado' && p.userId !== me?.id).map((p: any) => p.userId))];

  const put = async (m: any) => {
    setSending(m.id);
    try { await liveCmd(id, { type: 'select_marcha', marchaId: m.id }); toast({ kind: 'ok', text: `«${m.title}» puesta a todos` }); }
    catch (e) { toast({ kind: 'error', text: (e as Error).message }); } finally { setSending(null); }
  };
  const end = async () => {
    if (!confirm('¿Terminar el ensayo? A los músicos se les cerrará la pantalla del directo.')) return;
    await post(`/live/${id}/end`, {}).catch(() => {});
    onEnd();
  };
  const scores = ((current.data?.scores ?? []) as any[]).filter((x) => x.published_version_id || x.has_draft);

  return (
    <div className="page stack lg">
      <div className="row between">
        <div><div className="eyebrow"><span className="dot-status on" /> En directo</div><h1>Dirigiendo</h1></div>
        <div className="row">
          <span className="badge" title="Músicos conectados"><Users size={14} /> {people.length} conectados</span>
          <Link className="btn sm ghost" to={`/direccion/${id}`}><SlidersHorizontal size={15} /> Consola avanzada</Link>
          <button className="btn danger" onClick={end} data-testid="end-live"><Square size={16} /> Terminar</button>
        </div>
      </div>

      <div className="card stack">
        <div className="eyebrow">Marcha puesta ahora</div>
        {s?.marchaId ? (
          <>
            <h2>{s.marchaTitle ?? current.data?.title}</h2>
            <p className="small muted">A todos los músicos les sale en pantalla completa, con su voz, el sonido y las notas en colores.</p>
            <div className="row">
              <Link className="btn" to={`/tocar/${s.marchaId}`}><Eye size={16} /> Ver como músico</Link>
              {scores.map((x) => <button key={x.id} className="btn" onClick={() => nav(`/score/${x.id}`)}><Pencil size={16} /> Editar notas · {x.label}</button>)}
            </div>
            {scores.length > 0 && <p className="xs faint">Al publicar una corrección, a todos les cambia al momento.</p>}
          </>
        ) : <p className="muted">Todavía ninguna. Toca una marcha de la lista y se pondrá a todos.</p>}
      </div>

      <div className="card stack">
        <div className="card-title"><h3>Toca una marcha para ponerla a todos</h3><span className="xs faint">{list.length}</span></div>
        <div className="row nowrap"><Search size={18} className="faint" /><input className="input" placeholder="Busca una marcha…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar marcha" /></div>
        <div className="march-list">
          {list.map((m) => {
            const on = s?.marchaId === m.id;
            return (
              <button key={m.id} className={`march-row ${on ? 'on' : ''}`} onClick={() => put(m)} disabled={!!sending} data-testid="director-march">
                <span className="play-dot">{on ? <Check size={16} /> : <Play size={16} />}</span>
                <span className="grow" style={{ textAlign: 'left' }}><span className="march-title">{m.title}</span>{m.composer && <span className="xs faint"> · {m.composer}</span>}</span>
                {on ? <span className="badge accent">Puesta</span> : sending === m.id ? <span className="xs faint">Poniendo…</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
