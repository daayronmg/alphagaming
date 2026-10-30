import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Radio, Music, ChevronRight, Plus, MessageCircleQuestion, Baton, Check, X, Search, Play, MapPin, Clock } from '../components/icons';
import { useAuth } from '../lib/auth';
import { get, put } from '../lib/api';
import { useLoad, Notice, useToast, Modal } from '../components/ui';
import { fmtTime, EVENT_TYPES, assignmentLabel, fmtRelative } from '../lib/format';
import { useRealtime } from '../lib/realtime';

const REASONS = ['Trabajo', 'Estoy enfermo/a', 'Estudios', 'Viaje', 'Asunto familiar'];

/** Inicio: lo esencial a un toque — ¿hay ensayo?, ¿voy?, ¿qué marcha ha puesto el director?, elegir marcha y tocar. */
export default function Home() {
  const { me, can, branding } = useAuth();
  const toast = useToast();
  const events = useLoad(() => get<any[]>(`/events?from=${new Date(Date.now() - 3 * 3600_000).toISOString()}`), []);
  const live = useLoad(() => get<any[]>('/live/active'), []);
  const anns = useLoad(() => get<any[]>('/comms/announcements'), []);
  const marchas = useLoad(() => get<any[]>('/library/marchas'), []);
  const [q, setQ] = useState('');
  const [absent, setAbsent] = useState<any | null>(null);
  const [other, setOther] = useState('');
  useRealtime((m) => {
    if (m.t === 'events:changed') events.reload();
    if (m.t.startsWith('live:')) live.reload();
    if (m.t === 'announcement') anns.reload();
    if (m.t === 'parts:changed' || m.t === 'score:published') marchas.reload();
  }, []);
  if (!me) return null;
  const director = can('live.direct');
  const upcoming = (events.data ?? []).filter((e) => e.status === 'programado' && e.convoked);
  const next = upcoming[0];
  const later = upcoming.slice(1, 4);
  const session = live.data?.[0];
  const list = (marchas.data ?? []).filter((m) => !m.is_demo || (marchas.data ?? []).every((x) => x.is_demo))
    .filter((m) => !q || norm(m.title).includes(norm(q)) || norm(m.composer ?? '').includes(norm(q)));

  const answer = async (e: any, response: 'asistire' | 'no_asistire', reason?: string) => {
    try {
      await put(`/events/${e.id}/rsvp`, { response, reason: reason ?? null });
      events.reload(); setAbsent(null); setOther('');
      toast({ kind: 'ok', text: response === 'asistire' ? '¡Apuntado! Te esperamos.' : 'Hecho. La dirección ya lo sabe.' });
    } catch (x) { toast({ kind: 'error', text: (x as Error).message }); }
  };

  return (
    <div className="page stack lg home-simple">
      <section className="hero row nowrap" style={{ gap: 16 }}>
        {branding.logoFileId && <img src="/api/files/logo" alt={branding.bandName} className="home-logo" />}
        <div className="grow">
          <div className="eyebrow" style={{ color: 'var(--accent)' }}>{branding.bandName}</div>
          <h1 style={{ marginTop: 4 }}>Hola, {me.name.split(' ')[0]}</h1>
          <div className="row" style={{ marginTop: 8 }}>
            {me.assignments.map((a) => <span key={a.id} className={`badge ${a.is_default ? 'accent' : ''}`}><Music size={12} /> {assignmentLabel(a)}</span>)}
            {!me.assignments.length && me.role !== 'director' && <span className="badge warn">Aún no tienes instrumento asignado</span>}
          </div>
        </div>
      </section>

      {/* 1. El director está dirigiendo: directo a la marcha */}
      {session && (
        <Link to={director ? `/direccion/${session.id}` : `/directo/${session.id}`} className="card big-action live" data-testid="home-live">
          <span className="dot-status on" />
          <div className="grow">
            <div className="eyebrow">Ensayo en directo</div>
            <h2>{session.state?.marchaTitle ? session.state.marchaTitle : 'El director va a poner una marcha'}</h2>
            <div className="small muted">{session.state?.marchaTitle ? 'El director ha puesto esta marcha. Toca para ver tu partitura.' : 'Entra y te saldrá sola en cuanto la elija.'}</div>
          </div>
          <span className="btn primary lg"><Radio size={20} /> {director ? 'Consola' : 'Entrar'}</span>
        </Link>
      )}

      {/* 2. Próximo ensayo o actuación: voy / no voy */}
      {next ? (
        <div className="card stack" data-testid="home-next">
          <div className="row between">
            <div>
              <div className="eyebrow">{isToday(next.starts_at) ? 'Hoy' : 'Próximo'} · {EVENT_TYPES[next.type]}</div>
              <h2 style={{ marginTop: 4 }}>{next.title}</h2>
              <div className="row small muted" style={{ marginTop: 6, gap: 14 }}>
                <span className="row" style={{ gap: 4 }}><CalendarDays size={15} /> {bigDate(next.starts_at)}</span>
                <span className="row" style={{ gap: 4 }}><Clock size={15} /> {next.call_at ? `citación ${fmtTime(next.call_at)}` : fmtTime(next.starts_at)}</span>
                {next.location && <span className="row" style={{ gap: 4 }}><MapPin size={15} /> {next.location}</span>}
              </div>
              {next.last_minute && <div className="small" style={{ color: 'var(--danger)', fontWeight: 650, marginTop: 6 }}>⚠ {next.last_minute}</div>}
            </div>
            <Link to={`/eventos/${next.id}`} className="btn ghost sm">Detalles <ChevronRight size={16} /></Link>
          </div>
          {next.status === 'programado' && (
            <>
              {next.my_rsvp && <div className={`rsvp-state ${next.my_rsvp}`}>{next.my_rsvp === 'asistire' ? '✅ Has dicho que vas' : '❌ Has dicho que no vas'}</div>}
              <div className="rsvp-buttons">
                <button className={`btn lg yes ${next.my_rsvp === 'asistire' ? 'on' : ''}`} onClick={() => answer(next, 'asistire')} data-testid="rsvp-yes"><Check size={22} /> Voy</button>
                <button className={`btn lg no ${next.my_rsvp === 'no_asistire' ? 'on' : ''}`} onClick={() => setAbsent(next)} data-testid="rsvp-no"><X size={22} /> No voy</button>
              </div>
            </>
          )}
          {later.length > 0 && (
            <div className="stack sm">
              <div className="xs faint">Después</div>
              {later.map((e) => (
                <Link key={e.id} to={`/eventos/${e.id}`} className="list-item" style={{ padding: 8 }}>
                  <span className="small grow"><strong>{bigDate(e.starts_at)}</strong> · {e.title}</span>
                  {e.my_rsvp ? <span className={`badge ${e.my_rsvp === 'asistire' ? 'ok' : 'danger'}`}>{e.my_rsvp === 'asistire' ? 'Voy' : 'No voy'}</span> : <span className="badge warn">Sin responder</span>}
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="card"><div className="row"><CalendarDays size={20} className="faint" /><span className="muted">No hay ensayos ni actuaciones próximas.</span></div></div>
      )}

      {(anns.data ?? []).filter((a) => !a.read).slice(0, 2).map((a) => (
        <Notice key={a.id} kind={a.urgent ? 'danger' : 'info'} title={a.title}>{a.body} <Link to="/avisos" className="faint">· {fmtRelative(a.created_at)}</Link></Notice>
      ))}

      {me.role === 'director' && !branding.logoFileId && (
        <Notice kind="warn" title="Falta el logo de la banda">Súbelo en <Link to="/admin">Administración → Logotipo</Link> y saldrá en la entrada, en el menú y aquí arriba.</Notice>
      )}

      {director && (
        <div className="row">
          <Link className="btn primary" to={session ? `/direccion/${session.id}` : '/direccion'}><Baton size={18} /> {session ? 'Volver a la consola' : 'Dirigir ensayo'}</Link>
          <Link className="btn" to="/calendario?nuevo=1"><Plus size={18} /> Nuevo ensayo</Link>
          <Link className="btn" to="/dudas"><MessageCircleQuestion size={18} /> Dudas</Link>
        </div>
      )}

      {/* 3. Elegir una marcha y tocar */}
      <div className="card stack">
        <div className="card-title"><h3><Music size={18} /> Mis marchas</h3><span className="xs faint">{list.length}</span></div>
        <div className="row nowrap"><Search size={18} className="faint" /><input className="input" placeholder="Busca una marcha…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar marcha" /></div>
        {marchas.data && !list.length && <p className="muted small">{q ? 'No hay ninguna marcha con ese nombre.' : 'Todavía no hay marchas. La dirección las sube desde la Biblioteca.'}</p>}
        <div className="march-list">
          {list.slice(0, q ? 60 : 200).map((m) => (
            <Link key={m.id} to={`/tocar/${m.id}`} className="march-row" data-testid="march-row">
              <span className="play-dot"><Play size={16} /></span>
              <span className="grow"><span className="march-title">{m.title}</span>{m.composer && <span className="xs faint"> · {m.composer}</span>}</span>
              {m.scores > 0 && <span className="badge ok xs" title="Se puede escuchar">♪</span>}
              <ChevronRight size={16} className="faint" />
            </Link>
          ))}
        </div>
      </div>

      {absent && (
        <Modal title="¿Por qué no puedes ir?" onClose={() => setAbsent(null)}>
          <div className="stack">
            <div className="reason-grid">{REASONS.map((r) => <button key={r} className="btn lg" onClick={() => answer(absent, 'no_asistire', r)}>{r}</button>)}</div>
            <div className="row nowrap"><input className="input" placeholder="Otro motivo…" value={other} onChange={(e) => setOther(e.target.value)} /><button className="btn primary" disabled={!other.trim()} onClick={() => answer(absent, 'no_asistire', other.trim())}>Enviar</button></div>
            <p className="xs faint">Solo lo ve la dirección.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
function bigDate(iso: string) {
  const d = new Date(iso);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  if (isToday(iso)) return 'Hoy';
  if (d.toDateString() === tomorrow.toDateString()) return 'Mañana';
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}
