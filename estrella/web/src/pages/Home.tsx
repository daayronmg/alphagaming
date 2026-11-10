import { logoUrl } from '../components/Layout';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Radio, Music, ChevronRight, Baton, Check, X, Search, Play, MapPin, Clock, CalendarPlus, Upload, BarChart3 } from '../components/icons';
import { useAuth } from '../lib/auth';
import { get, put, post } from '../lib/api';
import { useLoad, Notice, useToast, Modal, Field } from '../components/ui';
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
  const [planning, setPlanning] = useState(false);
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
  const rehearsals = upcoming.filter((e) => e.type === 'ensayo').slice(0, 6);
  const shows = upcoming.filter((e) => e.type !== 'ensayo').slice(0, 6);
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
        <img src={logoUrl(branding)} alt={branding.bandName} className="home-logo" />
        <div className="grow">
          <div className="eyebrow">{greeting()}</div>
          <h1 style={{ marginTop: 4 }}>Hola, {me.name.split(' ')[0]}</h1>
          <div className="row" style={{ marginTop: 8 }}>
            {me.assignments.map((a) => <span key={a.id} className={`badge ${a.is_default ? 'accent' : ''}`}><Music size={12} /> {assignmentLabel(a)}</span>)}
            {!me.assignments.length && me.role !== 'director' && <span className="badge warn">Aún no tienes instrumento asignado</span>}
          </div>
        </div>
      </section>

      {director && (
        <div className="director-actions">
          <button className="director-tile" onClick={() => setPlanning(true)} data-testid="plan-rehearsal">
            <CalendarPlus size={28} /><b>Programar ensayo</b><span>Día, hora y lugar. A todos les llega para que digan si van.</span>
          </button>
          <Link className="director-tile dark" to="/dirigir" data-testid="direct-rehearsal">
            <Baton size={28} /><b>{session ? 'Seguir dirigiendo' : 'Dirigir ensayo'}</b><span>Tocas una marcha y a todos les sale al momento.</span>
          </Link>
          {can('library.manage') && (
            <Link className="director-tile" to="/biblioteca/importar" data-testid="upload-marchas">
              <Upload size={28} /><b>Subir marchas</b><span>Sube el PDF de una voz: la app separa cada marcha y saca las notas.</span>
            </Link>
          )}
          <Link className="director-tile" to="/estadisticas" data-testid="attendance-stats">
            <BarChart3 size={28} /><b>Asistencia</b><span>Recuento de cada componente: asistencias, retrasos y faltas.</span>
          </Link>
        </div>
      )}

      {/* 1. El director está dirigiendo: directo a la marcha */}
      {session && (
        <Link to={director ? '/dirigir' : '/en-directo'} className="card big-action live" data-testid="home-live">
          <span className="dot-status on" />
          <div className="grow">
            <div className="eyebrow">Ensayo en directo</div>
            <h2>{session.state?.marchaTitle ? session.state.marchaTitle : 'El director va a poner una marcha'}</h2>
            <div className="small muted">{session.state?.marchaTitle ? 'El director ha puesto esta marcha. Toca para ver tu partitura.' : 'Entra y te saldrá sola en cuanto la elija.'}</div>
          </div>
          <span className="btn primary lg"><Radio size={20} /> {director ? 'Dirigir' : 'Entrar'}</span>
        </Link>
      )}

      {/* 2. Agenda: tus ensayos y las próximas actuaciones, cada uno con su voy / no voy */}
      {next ? (
        <>
          {[['Tus ensayos', rehearsals] as const, ['Próximas actuaciones', shows] as const].filter(([, items]) => items.length > 0).map(([title, items]) => (
            <section key={title} className="stack sm" data-testid="agenda">
              <div className="row between"><h3 className="agenda-title">{title}</h3><Link to="/calendario" className="xs faint">Ver calendario</Link></div>
              {items.map((e) => (e.id === next.id ? (
                <div key={e.id} className="card stack" data-testid="home-next">
                  <div className="row between">
                    <div>
                      <div className="eyebrow">{isToday(e.starts_at) ? 'Hoy' : 'Próximo'} · {EVENT_TYPES[e.type]}</div>
                      <h2 style={{ marginTop: 4 }}>{e.title}</h2>
                      <div className="row small muted" style={{ marginTop: 6, gap: 14 }}>
                        <span className="row" style={{ gap: 4 }}><CalendarDays size={15} /> {bigDate(e.starts_at)}</span>
                        <span className="row" style={{ gap: 4 }}><Clock size={15} /> {e.call_at ? `citación ${fmtTime(e.call_at)}` : fmtTime(e.starts_at)}</span>
                        {e.location && <span className="row" style={{ gap: 4 }}><MapPin size={15} /> {e.location}</span>}
                      </div>
                      {e.last_minute && <div className="small" style={{ color: 'var(--danger)', fontWeight: 650, marginTop: 6 }}>⚠ {e.last_minute}</div>}
                    </div>
                    <Link to={`/eventos/${e.id}`} className="btn ghost sm">Detalles <ChevronRight size={16} /></Link>
                  </div>
                  {e.my_rsvp && <div className={`rsvp-state ${e.my_rsvp}`}>{e.my_rsvp === 'asistire' ? '✅ Has dicho que vas' : '❌ Has dicho que no vas'}</div>}
                  <div className="rsvp-buttons">
                    <button className={`btn lg yes ${e.my_rsvp === 'asistire' ? 'on' : ''}`} onClick={() => answer(e, 'asistire')} data-testid="rsvp-yes"><Check size={22} /> Voy</button>
                    <button className={`btn lg no ${e.my_rsvp === 'no_asistire' ? 'on' : ''}`} onClick={() => setAbsent(e)} data-testid="rsvp-no"><X size={22} /> No voy</button>
                  </div>
                  {director && <RsvpSummary eventId={e.id} />}
                </div>
              ) : (
                <div key={e.id} className="card agenda-item">
                  <Link to={`/eventos/${e.id}`} className="agenda-date" aria-label="Detalles">
                    <b>{new Date(e.starts_at).getDate()}</b><span>{new Date(e.starts_at).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')}</span>
                  </Link>
                  <Link to={`/eventos/${e.id}`} className="grow agenda-info">
                    <strong className="ellipsis">{e.title}</strong>
                    <span className="small muted ellipsis">{new Date(e.starts_at).toLocaleDateString('es-ES', { weekday: 'long' })} · {e.call_at ? `citación ${fmtTime(e.call_at)}` : fmtTime(e.starts_at)}{e.location ? ` · ${e.location}` : ''}</span>
                    {e.last_minute && <span className="xs" style={{ color: 'var(--danger)', fontWeight: 650 }}>⚠ {e.last_minute}</span>}
                    {!e.my_rsvp && <span className="xs" style={{ color: 'var(--warn, #b45309)', fontWeight: 650 }}>Sin responder</span>}
                  </Link>
                  <div className="agenda-rsvp">
                    <button className={`btn yes ${e.my_rsvp === 'asistire' ? 'on' : ''}`} onClick={() => answer(e, 'asistire')} aria-label={`Voy a ${e.title}`}><Check size={18} /> Voy</button>
                    <button className={`btn no ${e.my_rsvp === 'no_asistire' ? 'on' : ''}`} onClick={() => setAbsent(e)} aria-label={`No voy a ${e.title}`}><X size={18} /> No voy</button>
                  </div>
                </div>
              )))}
            </section>
          ))}
        </>
      ) : (
        <div className="card"><div className="row"><CalendarDays size={20} className="faint" /><span className="muted">No hay ensayos ni actuaciones próximas.</span></div></div>
      )}

      {(anns.data ?? []).filter((a) => !a.read).slice(0, 2).map((a) => (
        <Notice key={a.id} kind={a.urgent ? 'danger' : 'info'} title={a.title}>{a.body} <Link to="/avisos" className="faint">· {fmtRelative(a.created_at)}</Link></Notice>
      ))}


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

      {planning && <PlanRehearsal onClose={() => setPlanning(false)} onDone={() => { setPlanning(false); events.reload(); }} />}

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

const greeting = () => { const h = new Date().getHours(); return h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches'; };
/** Para la dirección: quién va, quién no (con su motivo) y quién no ha contestado al próximo ensayo. */
function RsvpSummary({ eventId }: { eventId: string }) {
  const ev = useLoad(() => get<any>(`/events/${eventId}`), [eventId]);
  useRealtime((m) => { if (m.t === 'rsvp' && m.eventId === eventId) ev.reload(); }, [eventId]);
  const roster: any[] = ev.data?.roster ?? [];
  if (!roster.length) return null;
  const yes = roster.filter((r) => r.rsvp?.response === 'asistire');
  const no = roster.filter((r) => r.rsvp?.response === 'no_asistire');
  const pending = roster.filter((r) => !r.rsvp);
  return (
    <div className="stack sm" data-testid="rsvp-summary">
      <div className="row" style={{ gap: 8 }}>
        <span className="badge ok">{yes.length} van</span>
        <span className="badge danger">{no.length} no van</span>
        <span className="badge warn">{pending.length} sin responder</span>
      </div>
      {no.length > 0 && (
        <div className="stack sm">
          {no.map((r) => <div key={r.id} className="small"><strong>{r.name}</strong> <span className="muted">· {r.rsvp.reason || 'sin motivo'}</span></div>)}
        </div>
      )}
      {pending.length > 0 && <div className="xs faint">Sin responder: {pending.map((r) => r.name.split(' ')[0]).join(', ')}</div>}
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

/** Programar un ensayo en tres datos: día, hora y lugar (se convoca a toda la banda). */
function PlanRehearsal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const tomorrow = new Date(Date.now() + 86400000);
  const [f, setF] = useState({ date: tomorrow.toISOString().slice(0, 10), time: '20:30', location: localStorage.getItem('estrella.lastPlace') ?? 'Local de ensayo', title: 'Ensayo' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const starts = new Date(`${f.date}T${f.time}:00`);
      await post('/events', { type: 'ensayo', title: f.title.trim() || 'Ensayo', starts_at: starts.toISOString(), location: f.location.trim() || null, section_ids: [] });
      try { localStorage.setItem('estrella.lastPlace', f.location); } catch { /* */ }
      toast({ kind: 'ok', text: 'Ensayo programado. A todos les aparece para responder si van.' });
      onDone();
    } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Programar ensayo" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !f.date || !f.time} onClick={save} data-testid="plan-save">{busy ? 'Guardando…' : 'Programar'}</button></>}>
      <div className="stack">
        <div className="form-grid">
          <Field label="Día"><input className="input" type="date" value={f.date} onChange={set('date')} /></Field>
          <Field label="Hora"><input className="input" type="time" value={f.time} onChange={set('time')} /></Field>
        </div>
        <Field label="Lugar"><input className="input" value={f.location} onChange={set('location')} /></Field>
        <Field label="Nombre (opcional)"><input className="input" value={f.title} onChange={set('title')} /></Field>
      </div>
    </Modal>
  );
}
