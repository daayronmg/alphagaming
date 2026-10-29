import { Link } from 'react-router-dom';
import { CalendarDays, Radio, Music, GraduationCap, Flame, ChevronRight, Megaphone, Plus, MessageCircleQuestion, Baton, Check, X } from '../components/icons';
import { useAuth } from '../lib/auth';
import { get, put } from '../lib/api';
import { useLoad, Notice, useToast } from '../components/ui';
import { fmtDate, fmtTime, EVENT_TYPES, assignmentLabel, fmtRelative } from '../lib/format';
import { useRealtime } from '../lib/realtime';

export default function Home() {
  const { me, can, branding } = useAuth();
  const toast = useToast();
  const events = useLoad(() => get<any[]>(`/events?from=${new Date(Date.now() - 3 * 3600_000).toISOString()}`), []);
  const live = useLoad(() => get<any[]>('/live/active'), []);
  const anns = useLoad(() => get<any[]>('/comms/announcements'), []);
  const stats = useLoad(() => get('/academy/me/stats'), []);
  const lib = useLoad(() => get<any[]>('/library/marchas?fav=1'), []);
  useRealtime((m) => { if (m.t === 'events:changed') events.reload(); if (m.t.startsWith('live:')) live.reload(); if (m.t === 'announcement') anns.reload(); }, []);
  if (!me) return null;
  const director = can('live.direct');
  const upcoming = (events.data ?? []).filter((e) => e.status !== 'cancelado' && e.convoked).slice(0, 4);
  const nextWithRep = upcoming.find((e) => e.repertoire_count > 0);
  const session = live.data?.[0];
  const hour = new Date().getHours();
  const hello = hour < 13 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';

  const rsvp = async (id: string, response: 'asistire' | 'no_asistire') => {
    let reason: string | null = null;
    if (response === 'no_asistire') { reason = prompt('Indica el motivo de la ausencia (lo verá la dirección):'); if (!reason) return; }
    try { await put(`/events/${id}/rsvp`, { response, reason }); events.reload(); toast({ kind: 'ok', text: 'Respuesta registrada' }); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); }
  };

  return (
    <div className="page stack lg">
      <section className="hero">
        <div className="eyebrow" style={{ color: 'var(--accent)', fontSize: '.75rem', letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 650 }}>{branding.bandName}</div>
        <h1 style={{ marginTop: 6 }}>{hello}, {me.name.split(' ')[0]}</h1>
        <div className="row" style={{ marginTop: 12 }}>
          {me.role === 'director' && <span className="badge accent">Dirección musical</span>}
          {me.assignments.map((a) => <span key={a.id} className={`badge ${a.is_default ? 'accent' : ''}`}><Music size={12} /> {assignmentLabel(a)}</span>)}
          {!me.assignments.length && me.role !== 'director' && <span className="badge warn">Sin instrumento asignado</span>}
        </div>
        {director && (
          <div className="row" style={{ marginTop: 18 }}>
            <Link className="btn primary" to={session ? `/direccion/${session.id}` : '/direccion'}><Baton size={18} /> {session ? 'Volver a la consola' : 'Dirigir ensayo'}</Link>
            <Link className="btn" to="/calendario?nuevo=1"><Plus size={18} /> Nuevo evento</Link>
            <Link className="btn" to="/dudas"><MessageCircleQuestion size={18} /> Bandeja de dudas</Link>
          </div>
        )}
      </section>

      {session && !director && (
        <Link to={`/directo/${session.id}`} className="card hover row" style={{ borderColor: 'var(--accent)' }}>
          <span className="dot-status on" />
          <div className="grow"><h3>Ensayo en directo</h3><div className="muted small">{session.state?.marchaTitle ? `Trabajando: ${session.state.marchaTitle}` : 'Esperando a que la dirección envíe una marcha'}</div></div>
          <span className="btn primary"><Radio size={18} /> Unirme</span>
        </Link>
      )}

      {(anns.data ?? []).filter((a) => !a.read).slice(0, 2).map((a) => (
        <Notice key={a.id} kind={a.urgent ? 'danger' : 'info'} title={a.title}>{a.body} <Link to="/avisos" className="faint">· {fmtRelative(a.created_at)}</Link></Notice>
      ))}

      <div className="grid cols-2">
        <div className="card">
          <div className="card-title"><h3><CalendarDays size={18} /> Próximas convocatorias</h3><Link to="/calendario" className="btn ghost sm">Calendario <ChevronRight size={16} /></Link></div>
          {!upcoming.length && <p className="muted small">No tienes convocatorias próximas.</p>}
          <div className="stack sm">
            {upcoming.map((e) => (
              <div key={e.id} className="list-item" style={{ padding: 10 }}>
                <div style={{ textAlign: 'center', minWidth: 52 }}><div className="xs faint">{fmtDate(e.starts_at).split(' ')[0]}</div><div style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700, lineHeight: 1 }}>{new Date(e.starts_at).getDate()}</div></div>
                <Link to={`/eventos/${e.id}`} className="grow">
                  <div style={{ fontWeight: 650 }}>{e.title}</div>
                  <div className="xs muted">{EVENT_TYPES[e.type]} · {e.call_at ? `convocatoria ${fmtTime(e.call_at)}` : fmtTime(e.starts_at)} · {e.location ?? ''}</div>
                  {e.last_minute && <div className="xs" style={{ color: 'var(--danger)', fontWeight: 650 }}>⚠ {e.last_minute}</div>}
                </Link>
                {e.status === 'programado' && (e.my_rsvp
                  ? <span className={`badge ${e.my_rsvp === 'asistire' ? 'ok' : 'danger'}`}>{e.my_rsvp === 'asistire' ? 'Asistiré' : 'No asistiré'}</span>
                  : <div className="row" style={{ gap: 4 }}>
                      <button className="btn sm icon" title="Asistiré" onClick={() => rsvp(e.id, 'asistire')}><Check size={16} /></button>
                      <button className="btn sm icon" title="No asistiré" onClick={() => rsvp(e.id, 'no_asistire')}><X size={16} /></button>
                    </div>)}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title"><h3><GraduationCap size={18} /> Mi estudio</h3><Link to="/academia" className="btn ghost sm">Academia <ChevronRight size={16} /></Link></div>
          <div className="grid cols-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="stat"><span className="v" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Flame size={22} color="var(--accent)" />{stats.data?.streak ?? 0}</span><span className="l">días de racha</span></div>
            <div className="stat"><span className="v">{stats.data?.lessons?.completed ?? 0}</span><span className="l">lecciones</span></div>
            <div className="stat"><span className="v">{stats.data?.totals?.answers ? Math.round((stats.data.totals.correct / stats.data.totals.answers) * 100) : 0}%</span><span className="l">aciertos</span></div>
          </div>
          {stats.data?.weak?.length > 0 && <p className="small muted" style={{ marginTop: 14 }}>Para repasar: {stats.data.weak.slice(0, 4).map((w: any) => w.item).join(', ')}</p>}
          <div className="row" style={{ marginTop: 14 }}>
            <Link className="btn sm" to="/academia/entrenamiento">Entrenar lectura</Link>
            <Link className="btn sm" to="/academia/herramientas">Afinador y metrónomo</Link>
          </div>
        </div>

        {nextWithRep && (
          <div className="card">
            <div className="card-title"><h3><Music size={18} /> Repertorio del próximo ensayo</h3></div>
            <Link to={`/eventos/${nextWithRep.id}`} className="muted small">{nextWithRep.title} · {fmtDate(nextWithRep.starts_at)}</Link>
            <RepertoireList eventId={nextWithRep.id} />
          </div>
        )}

        <div className="card">
          <div className="card-title"><h3><Megaphone size={18} /> Favoritas</h3><Link to="/biblioteca" className="btn ghost sm">Biblioteca <ChevronRight size={16} /></Link></div>
          {!(lib.data ?? []).length && <p className="muted small">Marca marchas como favoritas para tenerlas a mano.</p>}
          {(lib.data ?? []).slice(0, 5).map((m) => <Link key={m.id} to={`/marchas/${m.id}`} className="list-item" style={{ padding: 8 }}><Music size={16} /><span className="grow">{m.title}</span><ChevronRight size={16} /></Link>)}
        </div>
      </div>
    </div>
  );
}

function RepertoireList({ eventId }: { eventId: string }) {
  const ev = useLoad(() => get(`/events/${eventId}`), [eventId]);
  return (
    <div className="stack sm" style={{ marginTop: 10 }}>
      {(ev.data?.repertoire ?? []).map((m: any) => <Link key={m.id} to={`/marchas/${m.id}`} className="list-item" style={{ padding: 8 }}><Music size={16} /><span className="grow">{m.title}</span><span className="badge">Mi parte <ChevronRight size={12} /></span></Link>)}
    </div>
  );
}
