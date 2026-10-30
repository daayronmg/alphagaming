import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Play, Pause, Square, SkipBack, SkipForward, ChevronLeft, ChevronRight, Repeat, Timer, Send, BellOff, Bell, Eye, EyeOff, Navigation,
  Music, Search, Users, CheckCircle2, AlertTriangle, Radio, Power, ListChecks, FileText, FileMusic, Megaphone, X, Plus, Minus, ClipboardList,
} from '../components/icons';
import { get, post, put, patch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Spinner, Notice, Modal, Field, useToast, Empty, Tabs } from '../components/ui';
import { useLiveSession, positionAt, liveCmd } from '../lib/live';
import { rt, useTick, useRealtime, useChannel } from '../lib/realtime';
import { fmtDateTime, fmtTime, fmtDate } from '../lib/format';
import PartWorkspace from '../components/PartWorkspace';

export default function LiveDirector() {
  const { id } = useParams();
  const { can } = useAuth();
  if (!can('live.direct')) return <div className="page"><Notice kind="danger" title="Sin permiso">La consola de dirección está reservada a la dirección musical y a quien autorice.</Notice></div>;
  return id ? <Console id={id} /> : <StartSession />;
}

function StartSession() {
  const nav = useNavigate();
  const toast = useToast();
  const from = new Date(Date.now() - 6 * 3600_000).toISOString();
  const events = useLoad(() => get<any[]>(`/events?from=${from}&to=${new Date(Date.now() + 7 * 86400_000).toISOString()}`), []);
  const active = useLoad(() => get<any[]>('/live/active'), []);
  const start = async (event_id: string | null) => {
    try { const r = await post('/live', { event_id }); nav(`/direccion/${r.id}`); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); }
  };
  return (
    <div className="page stack lg">
      <div className="page-head"><div><div className="eyebrow">Dirección musical</div><h1>Panel de dirección</h1></div></div>
      {(active.data ?? []).length > 0 && <div className="card row between" style={{ borderColor: 'var(--accent)' }}><div><h3>Sesión en curso</h3><div className="small muted">{active.data![0].event_title ?? 'Sin evento'} · desde {fmtTime(active.data![0].started_at)}</div></div><Link className="btn primary" to={`/direccion/${active.data![0].id}`}>Volver a la consola</Link></div>}
      <div className="card">
        <div className="card-title"><h3><Radio size={18} /> Iniciar ensayo en directo</h3></div>
        <p className="small muted" style={{ marginBottom: 12 }}>Elige el ensayo. Los componentes conectados se unirán automáticamente y cada uno verá su propia parte.</p>
        <div className="stack sm">
          {(events.data ?? []).filter((e) => e.status !== 'cancelado').map((e) => (
            <div key={e.id} className="list-item">
              <div className="grow"><div style={{ fontWeight: 650 }}>{e.title}</div><div className="xs muted">{fmtDate(e.starts_at)} · {fmtTime(e.starts_at)} · {e.location ?? ''}</div></div>
              <button className="btn primary lg" onClick={() => start(e.id)} data-testid={`start-live-${e.id}`}><Play size={18} /> Iniciar</button>
            </div>
          ))}
          <button className="btn" onClick={() => start(null)} data-testid="start-live-free">Iniciar sesión libre (sin evento)</button>
        </div>
      </div>
    </div>
  );
}

function Console({ id }: { id: string }) {
  const toast = useToast();
  const nav = useNavigate();
  const live = useLiveSession(id, null);
  const s = live.state;
  const eventId: string | null = live.session?.event_id ?? null;
  const [presence, setPresence] = useState<any[]>([]);
  const [tab, setTab] = useState<'dispositivos' | 'partes' | 'plan' | 'incidencias'>('dispositivos');
  const [pick, setPick] = useState(false);
  const [jump, setJump] = useState('');
  const [loopF, setLoopF] = useState({ from: '', to: '' });
  const [msg, setMsg] = useState('');
  const [msgSecs, setMsgSecs] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [viewPart, setViewPart] = useState<string>('');
  const [worked, setWorked] = useState<{ marcha_id: string; title: string; from: number; to: number }[]>([]);
  const struct = useLoad(() => get<any[]>('/org/structure'), []);
  const event = useLoad(() => (eventId ? get(`/events/${eventId}`) : Promise.resolve(null)), [eventId]);
  const marcha = useLoad(() => (s?.marchaId ? get(`/library/marchas/${s.marchaId}`) : Promise.resolve(null)), [s?.marchaId]);
  const coverage = useLoad(() => (s?.marchaId ? get<any[]>(`/live/${id}/coverage`) : Promise.resolve([])), [s?.marchaId, id]);
  const incidents = useLoad(() => (tab === 'incidencias' ? get<any[]>(`/live/${id}/incidents`) : Promise.resolve([])), [tab, id]);
  const score = useLoad(() => {
    const sc = marcha.data?.scores?.find((x: any) => x.published_version_id);
    return sc ? get(`/scores/${sc.id}`) : Promise.resolve(null);
  }, [marcha.data?.id]);
  useChannel(eventId ? `event:${eventId}` : null);

  useEffect(() => { get<any[]>(`/live/${id}/presence`).then(setPresence).catch(() => {}); }, [id]);
  useRealtime((m) => {
    if (m.t === 'live:presence' && m.sessionId === id) { setPresence(m.devices); }
    if (m.t === 'plan:changed') event.reload();
    if (m.t === 'reconnected') get<any[]>(`/live/${id}/presence`).then(setPresence).catch(() => {});
  }, [id]);
  useEffect(() => { if (marcha.data) setViewPart(marcha.data.parts.find((p: any) => !p.instrument_id)?.id ?? marcha.data.parts[0]?.id ?? ''); }, [marcha.data?.id]); // eslint-disable-line

  const playing = s?.transport.status === 'playing';
  useTick(150, playing);
  if (!s) return <Spinner label="Cargando sesión…" />;
  if (live.ended) return <div className="page"><Notice kind="info" title="Sesión finalizada" /><Link className="btn" to="/direccion">Volver</Link></div>;
  const now = rt.serverNow();
  const pos = positionAt(s, now);
  const cur = playing ? Math.floor(pos) : s.measure;
  const countdown = playing ? Math.max(0, s.transport.anchorTs - now) : 0;

  const cmd = async (c: any) => {
    setBusy(true);
    try { await liveCmd(id, c); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };
  const marks: { name: string; from: number; to: number | null }[] = (() => {
    const doc = score.data?.published;
    if (!doc) return [];
    const ms = doc.measures.filter((m: any) => m.mark);
    return ms.map((m: any, i: number) => ({ name: m.mark, from: m.n, to: ms[i + 1] ? ms[i + 1].n - 1 : doc.measures.length }));
  })();
  const devices = presence;
  const counts = { on: devices.filter((d) => d.status === 'sincronizado').length, sync: devices.filter((d) => d.status === 'sincronizando').length, off: devices.filter((d) => d.status === 'desconectado').length };
  const missing = (coverage.data ?? []).filter((c) => c.status !== 'ok');
  const recordPassage = () => {
    if (!s.marchaId) return;
    const from = s.loop?.from ?? s.section?.from ?? cur;
    const to = s.loop?.to ?? s.section?.to ?? cur;
    setWorked((w) => [...w, { marcha_id: s.marchaId!, title: s.marchaTitle!, from, to: to ?? from }]);
    if (eventId) post(`/events/${eventId}/passages`, { marcha_id: s.marchaId, measure_from: from, measure_to: to, note: s.section?.name ?? null }).catch(() => {});
    toast({ kind: 'ok', text: `Pasaje c.${from}–${to} anotado como trabajado` });
  };

  return (
    <div className="page wide stack" data-testid="director-console">
      <div className="row between">
        <div>
          <div className="eyebrow" style={{ color: 'var(--accent)', fontSize: '.72rem', letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 650 }}>Dirección en directo{live.session?.event_title ? ` · ${live.session.event_title}` : ''}</div>
          <div className="row"><h1 style={{ fontSize: '1.8rem' }} data-testid="console-marcha">{s.marchaTitle ?? 'Sin marcha seleccionada'}</h1><span className="badge">v{live.version}</span></div>
        </div>
        <div className="row">
          <span className="badge ok"><span className="dot-status on" /> {counts.on} sincronizados</span>
          {counts.sync > 0 && <span className="badge warn">{counts.sync} sincronizando</span>}
          {counts.off > 0 && <span className="badge">{counts.off} desconectados</span>}
          <button className="btn danger" onClick={() => setEnding(true)}><Power size={16} /> Finalizar</button>
        </div>
      </div>

      <div className="console">
        <div className="stack">
          <div className="card stack">
            <div className="row between">
              <button className="btn xl primary" onClick={() => setPick(true)} data-testid="pick-marcha"><Music size={26} /> Seleccionar marcha</button>
              <div className="stack" style={{ alignItems: 'flex-end' }}>
                <span className={`transport-state ${s.transport.status}`}>{countdown > 0 ? `Entrada en ${(countdown / 1000).toFixed(1)} s` : s.transport.status === 'playing' ? 'Sonando' : s.transport.status === 'paused' ? 'En pausa' : 'Detenido'}</span>
                <div className="row nowrap"><span className="small muted">Compás</span><span className="measure-display" data-testid="console-measure">{cur}</span>{s.totalMeasures && <span className="muted">/ {s.totalMeasures}</span>}</div>
              </div>
            </div>
            <div className="console-big">
              {!playing ? <button className="btn xl primary" disabled={!s.marchaId || busy} onClick={() => cmd(s.transport.status === 'paused' ? { type: 'resume' } : { type: 'play' })} data-testid="cmd-play"><Play size={30} /> {s.transport.status === 'paused' ? 'Reanudar' : 'Iniciar'}</button>
                : <button className="btn xl" disabled={busy} onClick={() => cmd({ type: 'pause' })} data-testid="cmd-pause"><Pause size={30} /> Pausar</button>}
              <button className="btn xl" disabled={!s.marchaId || busy} onClick={() => cmd({ type: 'stop' })} data-testid="cmd-stop"><Square size={28} /> Detener</button>
              <button className="btn xl" disabled={!s.marchaId || busy} onClick={() => cmd({ type: 'step', delta: -1 })} data-testid="cmd-prev"><ChevronLeft size={30} /> Compás anterior</button>
              <button className="btn xl" disabled={!s.marchaId || busy} onClick={() => cmd({ type: 'step', delta: 1 })} data-testid="cmd-next"><ChevronRight size={30} /> Compás siguiente</button>
            </div>
            <div className="row">
              <form className="row nowrap" onSubmit={(e) => { e.preventDefault(); if (Number(jump)) { cmd({ type: 'measure', measure: Number(jump) }); setJump(''); } }}>
                <input className="input" style={{ width: 110, fontSize: '1.1rem' }} type="number" min={1} placeholder="Compás" value={jump} onChange={(e) => setJump(e.target.value)} disabled={!s.marchaId} data-testid="jump-input" />
                <button className="btn lg" disabled={!s.marchaId} data-testid="jump-go"><Navigation size={18} /> Ir al compás</button>
              </form>
              <button className="btn lg" onClick={() => cmd({ type: 'step', delta: -4 })} disabled={!s.marchaId}><SkipBack size={18} /> −4</button>
              <button className="btn lg" onClick={() => cmd({ type: 'step', delta: 4 })} disabled={!s.marchaId}>+4 <SkipForward size={18} /></button>
              <button className="btn lg" onClick={recordPassage} disabled={!s.marchaId} title="Anotar este pasaje como trabajado en el ensayo"><ClipboardList size={18} /> Pasaje trabajado</button>
            </div>
            {marks.length > 0 && (
              <div className="stack sm"><span className="xs faint" style={{ textTransform: 'uppercase', letterSpacing: '.1em' }}>Secciones de la marcha</span>
                <div className="chips">{marks.map((m) => <button key={m.name + m.from} className={`chip ${s.section?.name === m.name ? 'on' : ''}`} style={{ padding: '10px 16px', fontSize: '1rem' }} onClick={() => cmd({ type: 'section', section: m })}>{m.name} · c.{m.from}</button>)}
                  {s.section && <button className="chip" onClick={() => cmd({ type: 'section', section: null })}><X size={14} /> Quitar sección</button>}</div>
              </div>
            )}
            <div className="row">
              <span className="small muted">Repetir fragmento</span>
              <input className="input" type="number" min={1} style={{ width: 90 }} placeholder="desde" value={loopF.from} onChange={(e) => setLoopF({ ...loopF, from: e.target.value })} />
              <input className="input" type="number" min={1} style={{ width: 90 }} placeholder="hasta" value={loopF.to} onChange={(e) => setLoopF({ ...loopF, to: e.target.value })} />
              <button className={`btn lg ${s.loop ? 'on' : ''}`} disabled={!s.marchaId} onClick={() => (s.loop && !loopF.from ? cmd({ type: 'loop', loop: null }) : Number(loopF.from) && cmd({ type: 'loop', loop: { from: Number(loopF.from), to: Number(loopF.to || loopF.from) } }))}><Repeat size={18} /> {s.loop ? `Bucle c.${s.loop.from}–${s.loop.to}` : 'Activar bucle'}</button>
              {s.loop && <button className="btn" onClick={() => { cmd({ type: 'loop', loop: null }); setLoopF({ from: '', to: '' }); }}><X size={16} /> Quitar</button>}
            </div>
            <div className="row">
              <span className="small muted">Tempo</span>
              <button className="btn lg icon" onClick={() => cmd({ type: 'tempo', tempo: s.tempo - 4 })}><Minus size={18} /></button>
              <span className="mono" style={{ fontSize: '1.4rem', minWidth: 76, textAlign: 'center' }} data-testid="console-tempo">♩={s.tempo}</span>
              <button className="btn lg icon" onClick={() => cmd({ type: 'tempo', tempo: s.tempo + 4 })}><Plus size={18} /></button>
              <select className="input" style={{ width: 'auto' }} value={s.beatsPerMeasure} onChange={(e) => cmd({ type: 'meter', beatsPerMeasure: Number(e.target.value) })} aria-label="Tiempos por compás">{[2, 3, 4, 6].map((b) => <option key={b} value={b}>{b} tiempos</option>)}</select>
              <button className={`btn lg ${s.metronome ? 'on' : ''}`} onClick={() => cmd({ type: 'metronome', on: !s.metronome })}><Timer size={18} /> Metrónomo</button>
              <button className={`btn lg ${s.follow ? 'on' : ''}`} onClick={() => cmd({ type: 'follow', on: !s.follow })} title="Lleva a los músicos al compás que se trabaja"><Navigation size={18} /> Seguimiento</button>
              <button className={`btn lg ${s.silent ? 'on' : ''}`} onClick={() => cmd({ type: 'silent', on: !s.silent })} title="Silenciar notificaciones no urgentes">{s.silent ? <BellOff size={18} /> : <Bell size={18} />} Silencio</button>
              <button className={`btn lg ${s.showAnnotations ? 'on' : ''}`} onClick={() => cmd({ type: 'annotations', on: !s.showAnnotations })}>{s.showAnnotations ? <Eye size={18} /> : <EyeOff size={18} />} Anotaciones</button>
              <select className="input" style={{ width: 'auto' }} value={s.view} onChange={(e) => cmd({ type: 'view', view: e.target.value })} aria-label="Cambiar partitura"><option value="auto">Partitura: automática</option><option value="pdf">Partitura: PDF original</option><option value="score">Partitura: editable</option></select>
            </div>
          </div>

          <div className="card stack sm">
            <div className="card-title"><h3><Megaphone size={18} /> Indicación a los músicos</h3></div>
            <div className="chips">
              <button className={`chip ${!msgSecs.length ? 'on' : ''}`} onClick={() => setMsgSecs([])}>Toda la banda</button>
              {(struct.data ?? []).map((sec) => <button key={sec.id} className={`chip ${msgSecs.includes(sec.id) ? 'on' : ''}`} onClick={() => setMsgSecs(msgSecs.includes(sec.id) ? msgSecs.filter((x) => x !== sec.id) : [...msgSecs, sec.id])}>{sec.name}</button>)}
            </div>
            <div className="chips">{['Atención a la entrada', 'No acelerar', 'Más suave', 'Respirar juntos', 'Desde el principio', 'Mantener el pulso'].map((q) => <button key={q} className="chip" onClick={() => setMsg(q)}>{q}</button>)}</div>
            <form className="row nowrap" onSubmit={(e) => { e.preventDefault(); if (!msg.trim()) return; cmd({ type: 'message', text: msg.trim(), audience: msgSecs.length ? { scope: 'sections', sections: msgSecs } : { scope: 'all' } }); setMsg(''); }}>
              <input className="input" style={{ fontSize: '1.05rem' }} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Escribe una indicación…" data-testid="director-msg-input" />
              <button className="btn primary lg" data-testid="director-msg-send"><Send size={18} /> Enviar</button>
            </form>
            {s.messages.slice(0, 3).map((m) => <div key={m.id} className="small muted">{fmtTime(new Date(m.at))} · {m.text} {m.audience.scope === 'sections' ? `(${m.audience.sections.map((x: number) => struct.data?.find((q) => q.id === x)?.name).join(', ')})` : '(todos)'}</div>)}
          </div>

          {s.marchaId && marcha.data && (
            <div className="card flat stack sm" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="row" style={{ padding: '10px 14px' }}>
                <strong className="small">Partitura en la tableta:</strong>
                <select className="input" style={{ width: 'auto' }} value={viewPart} onChange={(e) => setViewPart(e.target.value)}>{marcha.data.parts.map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
                <span className="xs muted">Las indicaciones «en compás» llegan a cada músico sobre su propia parte; los dibujos, a quien vea esta misma parte.</span>
              </div>
              {viewPart ? <PartWorkspace key={viewPart} partId={viewPart} eventId={eventId} height="70vh" panelDefault={false} live={{ measure: cur, loop: s.loop, sectionName: s.section?.name, follow: true, showAnnotations: true, key: live.version * 1000 + (cur ?? 0) }} /> : <p className="small muted" style={{ padding: 14 }}>Esta marcha no tiene partituras subidas.</p>}
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card stack sm">
            <Tabs value={tab} onChange={setTab} items={[{ value: 'dispositivos', label: `Dispositivos (${devices.length})` }, { value: 'partes', label: `Partes${missing.length ? ` ⚠${missing.length}` : ''}` }, { value: 'plan', label: 'Plan' }, { value: 'incidencias', label: 'Incidencias' }]} />
            {tab === 'dispositivos' && (
              <div className="stack sm" data-testid="presence-list">
                {!devices.length && <p className="small muted">Aún no hay dispositivos conectados a la sesión.</p>}
                {devices.map((d) => (
                  <div key={d.deviceId} className="row nowrap small" data-testid="presence-row" data-name={d.name} data-status={d.status}>
                    <span className={`dot-status ${d.status === 'sincronizado' ? 'on' : d.status === 'sincronizando' ? 'sync' : 'off'}`} />
                    <span className="grow ellipsis">{d.name} <span className="faint">· {d.label}</span></span>
                    <span className="xs faint">{d.status}{d.lagMs ? ` · ${d.lagMs} ms` : ''}</span>
                  </div>
                ))}
                <p className="xs faint">Sincronizado: tiene la última orden. Sincronizando: está recuperando el estado. Desconectado: ha perdido la conexión (al volver recupera la marcha y el compás actuales).</p>
              </div>
            )}
            {tab === 'partes' && (
              <div className="stack sm">
                {!s.marchaId && <p className="small muted">Selecciona una marcha.</p>}
                {(coverage.data ?? []).map((c) => (
                  <div key={c.user_id} className="row nowrap small">
                    {c.status === 'ok' ? <CheckCircle2 size={15} color="var(--ok)" /> : <AlertTriangle size={15} color="var(--warn)" />}
                    <span className="grow ellipsis">{c.name}{c.online ? '' : ' (sin conexión)'}<div className="xs faint">{c.assignment ?? 'sin asignación'} → {c.part ?? c.score ?? 'falta su parte'}</div></span>
                    {c.assignments.length > 1 && eventId && <select className="input" style={{ width: 130, minHeight: 30, padding: '2px 6px', fontSize: '.78rem' }} defaultValue="" onChange={async (e) => { await put(`/events/${eventId}/overrides`, { user_id: c.user_id, assignment_id: e.target.value ? Number(e.target.value) : null }); coverage.reload(); }}><option value="">Por defecto</option>{c.assignments.map((a: any) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>}
                  </div>
                ))}
                <button className="btn sm" onClick={coverage.reload}>Actualizar</button>
              </div>
            )}
            {tab === 'plan' && (
              <div className="stack sm">
                {!eventId && <p className="small muted">Sesión sin evento: no hay plan de trabajo.</p>}
                {(event.data?.plan ?? []).map((it: any, i: number) => (
                  <div key={it.id} className={`list-item ${s.planItemId === it.id ? 'card flat tight' : ''}`} style={{ padding: 8 }}>
                    <input type="checkbox" checked={it.done} onChange={async (e) => { await patch(`/events/${eventId}/plan/${it.id}`, { done: e.target.checked }); event.reload(); }} aria-label="Hecho" />
                    <div className="grow"><div className="small" style={{ fontWeight: 650, textDecoration: it.done ? 'line-through' : undefined }}>{i + 1}. {it.title}</div>{it.marcha_title && <div className="xs muted">{it.marcha_title}{it.measure_from ? ` · c.${it.measure_from}${it.measure_to ? `–${it.measure_to}` : ''}` : ''}</div>}</div>
                    {(it.marcha_id || it.measure_from) && <button className="btn sm" onClick={() => cmd({ type: 'plan_item', itemId: it.id })}><Send size={14} /></button>}
                  </div>
                ))}
                {eventId && <Link to={`/eventos/${eventId}`} className="btn sm"><ListChecks size={14} /> Editar plan y asistencia</Link>}
              </div>
            )}
            {tab === 'incidencias' && (
              <div className="stack sm">
                {(incidents.data ?? []).slice(0, 40).map((x, i) => <div key={i} className="xs"><span className="faint">{fmtTime(x.at)}</span> · {x.name ?? '—'} · {x.kind === 'late_command' ? `orden recibida con ${x.detail?.lateMs} ms de retraso` : x.kind === 'connect' ? 'conectado' : x.kind === 'disconnect' ? 'desconectado' : x.kind}</div>)}
                {!incidents.data?.length && <p className="small muted">Sin incidencias registradas.</p>}
              </div>
            )}
          </div>
          {worked.length > 0 && <div className="card stack sm"><h3>Pasajes trabajados hoy</h3>{worked.map((w, i) => <div key={i} className="small">{w.title} · c.{w.from}–{w.to}</div>)}</div>}
          {eventId && <Link to={`/eventos/${eventId}`} className="btn"><Users size={16} /> Asistencia del ensayo</Link>}
          <Notice kind="info" title="Sincronización">Cada «Iniciar» se programa {1.5} s en el futuro según el reloj del servidor, para que todos los dispositivos arranquen a la vez. Si una orden llega tarde, el dispositivo recalcula su posición.</Notice>
        </div>
      </div>

      {pick && <MarchaPicker eventRepertoire={event.data?.repertoire ?? []} onClose={() => setPick(false)} onPick={(mid) => { cmd({ type: 'select_marcha', marchaId: mid }); setPick(false); }} />}
      {ending && <EndModal eventId={eventId} worked={worked} onClose={() => setEnding(false)} onEnded={async () => { await post(`/live/${id}/end`); nav(eventId ? `/eventos/${eventId}` : '/'); }} />}
    </div>
  );
}

function MarchaPicker({ onClose, onPick, eventRepertoire }: { onClose: () => void; onPick: (id: string) => void; eventRepertoire: any[] }) {
  const [q, setQ] = useState('');
  const list = useLoad(() => get<any[]>(`/library/marchas?q=${encodeURIComponent(q)}`), [q]);
  return (
    <Modal title="Seleccionar marcha" onClose={onClose} wide>
      <div className="stack">
        {eventRepertoire.length > 0 && <><div className="xs faint" style={{ textTransform: 'uppercase', letterSpacing: '.1em' }}>Repertorio del ensayo</div>
          <div className="grid cols-3">{eventRepertoire.map((m) => <button key={m.id} className="btn xl" onClick={() => onPick(m.id)} data-testid="pick-option"><Music size={22} /> {m.title}</button>)}</div></>}
        <div className="row nowrap"><Search size={18} /><input className="input" autoFocus placeholder="Buscar en la biblioteca…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="stack sm">{(list.data ?? []).map((m) => (
          <button key={m.id} className="list-item btn ghost" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => onPick(m.id)} data-testid="pick-option">
            <Music size={18} /><span className="grow"><strong>{m.title}</strong><div className="xs muted">{m.composer ?? ''} · {m.parts} partituras · {m.scores} editables</div></span>
            <span className="btn sm primary"><Send size={14} /> Enviar al ensayo</span>
          </button>
        ))}</div>
        {!list.data?.length && <Empty title="Sin resultados" />}
      </div>
    </Modal>
  );
}

function EndModal({ eventId, worked, onClose, onEnded }: { eventId: string | null; worked: any[]; onClose: () => void; onEnded: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ worked: worked.map((w) => `${w.title}: c.${w.from}–${w.to}`).join('\n'), incidents: '', tasks: '' });
  const finish = async () => {
    try {
      if (eventId) await put(`/events/${eventId}/summary`, { ...f, finish: true });
      toast({ kind: 'ok', text: 'Ensayo finalizado y resumen guardado' });
      onEnded();
    } catch (e) { toast({ kind: 'error', text: (e as Error).message }); }
  };
  return (
    <Modal title="Finalizar ensayo" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Seguir</button><button className="btn danger" onClick={onEnded}>Finalizar sin resumen</button><button className="btn primary" onClick={finish} data-testid="save-summary">Guardar resumen y finalizar</button></>}>
      <div className="stack">
        {!eventId && <Notice kind="warn">Sesión sin evento: el resumen no se puede guardar.</Notice>}
        <Field label="Contenidos trabajados"><textarea className="input" value={f.worked} onChange={(e) => setF({ ...f, worked: e.target.value })} data-testid="summary-worked" /></Field>
        <Field label="Incidencias musicales"><textarea className="input" value={f.incidents} onChange={(e) => setF({ ...f, incidents: e.target.value })} /></Field>
        <Field label="Tareas para el próximo ensayo"><textarea className="input" value={f.tasks} onChange={(e) => setF({ ...f, tasks: e.target.value })} /></Field>
        {eventId && <Link to={`/eventos/${eventId}`} className="small muted">Registrar asistencia antes de cerrar →</Link>}
      </div>
    </Modal>
  );
}

