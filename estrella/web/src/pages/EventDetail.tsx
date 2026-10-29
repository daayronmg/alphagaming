import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  MapPin, Clock, Shirt, Pencil, Trash2, QrCode, Download, Radio, Check, X, ListChecks, Plus, ArrowUp, ArrowDown, History, Music, ClipboardList, Save,
} from '../components/icons';
import { get, put, post, del } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Spinner, ErrorBox, Notice, Modal, Field, useToast, Tabs } from '../components/ui';
import { useRealtime, useChannel } from '../lib/realtime';
import { EVENT_TYPES, ATT_LABEL, fmtDateLong, fmtTime, fmtDateTime, fmtDate } from '../lib/format';
import { EventForm } from './Calendar';

export default function EventDetail() {
  const { id } = useParams();
  const { can, me } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const ev = useLoad(() => get(`/events/${id}`), [id]);
  const lib = useLoad(() => get<any[]>('/library/marchas'), []);
  const [tab, setTab] = useState<'asistencia' | 'plan' | 'resumen'>('asistencia');
  const [editing, setEditing] = useState(false);
  const [qr, setQr] = useState(false);
  const [log, setLog] = useState(false);
  useChannel(id ? `event:${id}` : null);
  useRealtime((m) => { if ((m.t === 'events:changed' || m.t === 'attendance:changed' || m.t === 'rsvp' || m.t === 'plan:changed') && (!m.eventId || m.eventId === id)) ev.reload(); }, [id]);

  if (ev.error) return <div className="page"><ErrorBox error={ev.error} retry={ev.reload} /></div>;
  if (!ev.data) return <Spinner />;
  const e = ev.data;
  const manage = can('events.manage');
  const rsvp = async (response: string) => {
    let reason: string | null = null;
    if (response === 'no_asistire') { reason = prompt('Motivo de la ausencia:'); if (!reason) return; }
    try { await put(`/events/${id}/rsvp`, { response, reason }); ev.reload(); } catch (x) { toast({ kind: 'error', text: (x as Error).message }); }
  };
  const mark = async (user_id: string, status: string) => {
    let minutes_late: number | null = null;
    if (status === 'retraso') minutes_late = Number(prompt('Minutos de retraso:', '5') || 0);
    try { await put(`/events/${id}/attendance`, [{ user_id, status, minutes_late }]); ev.reload(); } catch (x) { toast({ kind: 'error', text: (x as Error).message }); }
  };
  const markAll = async (status: string) => {
    const pending = (e.roster ?? []).filter((r: any) => !r.attendance);
    if (!pending.length) return;
    await put(`/events/${id}/attendance`, pending.map((r: any) => ({ user_id: r.id, status: r.rsvp?.response === 'no_asistire' && status === 'ausente' ? 'justificada' : status })));
    ev.reload();
  };
  const counts = (e.roster ?? []).reduce((a: any, r: any) => { const s = r.attendance?.status ?? 'pendiente'; a[s] = (a[s] ?? 0) + 1; return a; }, {});

  return (
    <div className="page stack lg">
      <div className="hero">
        <div className="row between">
          <div className="stack sm">
            <div className="row" style={{ gap: 6 }}><span className="badge accent">{EVENT_TYPES[e.type]}</span>{e.status !== 'programado' && <span className={`badge ${e.status === 'cancelado' ? 'danger' : 'ok'}`}>{e.status}</span>}{e.live && <span className="badge ok">En directo</span>}</div>
            <h1>{e.title}</h1>
            <div className="muted">{fmtDateLong(e.starts_at)}</div>
          </div>
          <div className="row">
            {can('live.direct') && e.status === 'programado' && <button className="btn primary" onClick={async () => { const r = await post('/live', { event_id: id }); nav(`/direccion/${r.id}`); }}><Radio size={16} /> {e.live ? 'Abrir consola' : 'Dirigir en directo'}</button>}
            {!can('live.direct') && e.live && <Link className="btn primary" to={`/directo/${e.live.id}`}><Radio size={16} /> Unirme</Link>}
            {manage && <button className="btn" onClick={() => setEditing(true)}><Pencil size={16} /> Editar</button>}
            {manage && <button className="btn icon" aria-label="Eliminar" onClick={async () => { if (confirm('¿Eliminar este evento?')) { await del(`/events/${id}`); nav('/calendario'); } }}><Trash2 size={16} /></button>}
          </div>
        </div>
        <div className="grid cols-3" style={{ marginTop: 18 }}>
          <div className="row nowrap"><Clock size={18} className="faint" /><div className="small">{e.call_at && <div>Convocatoria: <strong>{fmtTime(e.call_at)}</strong></div>}<div>Inicio: <strong>{fmtTime(e.starts_at)}</strong>{e.ends_at ? ` · fin ${fmtTime(e.ends_at)}` : ''}</div></div></div>
          {e.location && <div className="row nowrap"><MapPin size={18} className="faint" /><span className="small">{e.location}</span></div>}
          {e.uniform && <div className="row nowrap"><Shirt size={18} className="faint" /><span className="small">{e.uniform}</span></div>}
        </div>
        {e.responsible_name && <p className="small muted" style={{ marginTop: 10 }}>Responsable: {e.responsible_name}</p>}
        {e.last_minute && <Notice kind="danger" title="Cambio de última hora">{e.last_minute}</Notice>}
        {e.notes && <p className="pre small" style={{ marginTop: 12 }}>{e.notes}</p>}
      </div>

      {e.convoked && e.status === 'programado' && (
        <div className="card row between">
          <div><h3>¿Asistirás?</h3><p className="small muted">{e.my.rsvp ? `Has respondido: ${e.my.rsvp.response === 'asistire' ? 'asistiré' : 'no asistiré'}${e.my.rsvp.reason ? ` (${e.my.rsvp.reason})` : ''}` : 'Confirma para que la dirección pueda organizar el ensayo.'}</p></div>
          <div className="row"><button className={`btn lg ${e.my.rsvp?.response === 'asistire' ? 'on' : ''}`} onClick={() => rsvp('asistire')}><Check size={18} /> Asistiré</button><button className={`btn lg ${e.my.rsvp?.response === 'no_asistire' ? 'on' : ''}`} onClick={() => rsvp('no_asistire')}><X size={18} /> No asistiré</button></div>
        </div>
      )}
      {e.my.attendance && <Notice kind={e.my.attendance.status === 'presente' ? 'ok' : 'info'} title={`Registro oficial: ${ATT_LABEL[e.my.attendance.status]}`}>{e.my.attendance.minutes_late ? `${e.my.attendance.minutes_late} min de retraso · ` : ''}Registrado por la dirección ({e.my.attendance.method === 'qr' ? 'código QR' : 'manual'}). Si no es correcto, habla con tu responsable.</Notice>}

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-title"><h3><Music size={18} /> Repertorio</h3></div>
          {!e.repertoire.length && <p className="small muted">Sin repertorio asignado.</p>}
          <div className="stack sm">{e.repertoire.map((m: any) => <Link key={m.id} to={`/marchas/${m.id}`} className="list-item" style={{ padding: 8 }}><Music size={16} /><span className="grow">{m.title}</span><span className="badge">Mi parte</span></Link>)}</div>
        </div>
        {e.summary && (
          <div className="card stack sm">
            <div className="card-title"><h3><ClipboardList size={18} /> Resumen del ensayo</h3><span className="xs faint">{e.summary.saved_by} · {fmtDateTime(e.summary.saved_at)}</span></div>
            {e.summary.worked && <div><strong className="small">Trabajado</strong><p className="pre small">{e.summary.worked}</p></div>}
            {e.summary.incidents && <div><strong className="small">Incidencias</strong><p className="pre small">{e.summary.incidents}</p></div>}
            {e.summary.tasks && <div><strong className="small">Para el próximo ensayo</strong><p className="pre small">{e.summary.tasks}</p></div>}
          </div>
        )}
      </div>

      {(e.can_record || manage) && (
        <div className="stack">
          <Tabs value={tab} onChange={setTab} items={[{ value: 'asistencia', label: 'Asistencia' }, { value: 'plan', label: 'Plan de trabajo' }, { value: 'resumen', label: 'Resumen y pasajes' }]} />
          {tab === 'asistencia' && e.roster && (
            <div className="card stack">
              <div className="row between">
                <div className="row" style={{ gap: 6 }}>{Object.entries(ATT_LABEL).map(([k, v]) => <span key={k} className="badge">{v}: {counts[k] ?? 0}</span>)}</div>
                <div className="row">
                  <button className="btn sm" onClick={() => setQr(true)}><QrCode size={15} /> Registro por QR</button>
                  <button className="btn sm" onClick={() => markAll('presente')}>Pendientes → presente</button>
                  <button className="btn sm" onClick={() => setLog(true)}><History size={15} /> Historial</button>
                  {manage && <a className="btn sm" href={`/api/events/${id}/export.csv`}><Download size={15} /> CSV</a>}
                </div>
              </div>
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Componente</th><th>Confirmación</th><th>Registro oficial</th></tr></thead>
                <tbody>{e.roster.map((r: any) => (
                  <tr key={r.id}>
                    <td><div style={{ fontWeight: 600 }}>{r.name}</div><div className="xs muted">{r.assignment ?? 'Sin asignación'}</div></td>
                    <td>{r.rsvp ? <span className={`badge ${r.rsvp.response === 'asistire' ? 'ok' : 'danger'}`} title={r.rsvp.reason ?? ''}>{r.rsvp.response === 'asistire' ? 'Asistirá' : `No asistirá${r.rsvp.reason ? ': ' + r.rsvp.reason : ''}`}</span> : <span className="badge">Pendiente</span>}</td>
                    <td><div className="att-btns">{['presente', 'retraso', 'ausente', 'justificada'].map((s) => <button key={s} className={`${s} ${r.attendance?.status === s ? 'on' : ''}`} onClick={() => mark(r.id, s)}>{ATT_LABEL[s]}{s === 'retraso' && r.attendance?.status === s && r.attendance.minutes_late ? ` ${r.attendance.minutes_late}'` : ''}</button>)}</div>
                      {r.attendance && <div className="xs faint" style={{ marginTop: 3 }}>{r.attendance.method === 'qr' ? 'QR' : r.attendance.recorded_by_name} · {fmtTime(r.attendance.recorded_at)}</div>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
              <p className="xs faint">Solo la dirección y los responsables autorizados modifican el registro oficial. Cada cambio queda en el historial.</p>
            </div>
          )}
          {tab === 'plan' && <PlanEditor eventId={id!} plan={e.plan} marchas={lib.data ?? []} canEdit={manage} onSaved={ev.reload} />}
          {tab === 'resumen' && <SummaryEditor e={e} canEdit={manage || can('live.direct')} onSaved={ev.reload} marchas={lib.data ?? []} />}
        </div>
      )}

      {editing && <EventForm initial={e} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); ev.reload(); }} />}
      {qr && <QrPanel eventId={id!} onClose={() => { setQr(false); ev.reload(); }} />}
      {log && <AttLog eventId={id!} onClose={() => setLog(false)} />}
      {me && null}
    </div>
  );
}

function PlanEditor({ eventId, plan, marchas, canEdit, onSaved }: { eventId: string; plan: any[]; marchas: any[]; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<any[]>(plan);
  useEffect(() => setItems(plan), [plan]);
  const upd = (i: number, k: string, v: any) => setItems(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const move = (i: number, d: number) => { const n = [...items]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setItems(n); };
  const save = async () => {
    try { await put(`/events/${eventId}/plan`, items.map((it) => ({ id: it.id, title: it.title, marcha_id: it.marcha_id || null, measure_from: it.measure_from ? Number(it.measure_from) : null, measure_to: it.measure_to ? Number(it.measure_to) : null, notes: it.notes || null, done: !!it.done }))); toast({ kind: 'ok', text: 'Plan guardado' }); onSaved(); }
    catch (e) { toast({ kind: 'error', text: (e as Error).message }); }
  };
  return (
    <div className="card stack">
      <div className="card-title"><h3><ListChecks size={18} /> Lista de trabajo</h3>{canEdit && <div className="row"><button className="btn sm" onClick={() => setItems([...items, { title: '', marcha_id: '', measure_from: '', measure_to: '' }])}><Plus size={14} /> Punto</button><button className="btn sm primary" onClick={save}><Save size={14} /> Guardar</button></div>}</div>
      {!items.length && <p className="small muted">Ejemplo: calentamiento, marcha A (compases), marcha B (introducción), repetición de un fragmento, repaso general, cierre.</p>}
      {items.map((it, i) => (
        <div key={it.id ?? i} className="row nowrap" style={{ alignItems: 'flex-start' }}>
          <span className="badge" style={{ marginTop: 10 }}>{i + 1}</span>
          {canEdit ? (
            <div className="form-grid grow" style={{ gridTemplateColumns: '2fr 2fr 80px 80px' }}>
              <input className="input" placeholder="Título" value={it.title} onChange={(e) => upd(i, 'title', e.target.value)} />
              <select className="input" value={it.marcha_id ?? ''} onChange={(e) => upd(i, 'marcha_id', e.target.value)}><option value="">Sin marcha</option>{marchas.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
              <input className="input" type="number" placeholder="desde" value={it.measure_from ?? ''} onChange={(e) => upd(i, 'measure_from', e.target.value)} />
              <input className="input" type="number" placeholder="hasta" value={it.measure_to ?? ''} onChange={(e) => upd(i, 'measure_to', e.target.value)} />
            </div>
          ) : <div className="grow"><strong>{it.title}</strong> {it.marcha_title && <span className="muted small">· {it.marcha_title}{it.measure_from ? ` c.${it.measure_from}–${it.measure_to ?? ''}` : ''}</span>}</div>}
          {canEdit && <><button className="btn icon sm" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button><button className="btn icon sm" disabled={i === items.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button><button className="btn icon sm" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 size={14} /></button></>}
          {it.done && <span className="badge ok">Hecho</span>}
        </div>
      ))}
    </div>
  );
}

function SummaryEditor({ e, canEdit, onSaved, marchas }: { e: any; canEdit: boolean; onSaved: () => void; marchas: any[] }) {
  const toast = useToast();
  const [f, setF] = useState({ worked: e.summary?.worked ?? '', incidents: e.summary?.incidents ?? '', tasks: e.summary?.tasks ?? '' });
  const [p, setP] = useState({ marcha_id: '', from: '', to: '', note: '' });
  const repeated = useLoad(() => get<any[]>('/events/passages/repeated'), []);
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="card stack">
        <h3>Resumen</h3>
        <Field label="Contenidos trabajados"><textarea className="input" readOnly={!canEdit} value={f.worked} onChange={(x) => setF({ ...f, worked: x.target.value })} /></Field>
        <Field label="Incidencias musicales"><textarea className="input" readOnly={!canEdit} value={f.incidents} onChange={(x) => setF({ ...f, incidents: x.target.value })} /></Field>
        <Field label="Tareas para el próximo ensayo"><textarea className="input" readOnly={!canEdit} value={f.tasks} onChange={(x) => setF({ ...f, tasks: x.target.value })} /></Field>
        {canEdit && <div className="row"><button className="btn" onClick={async () => { await put(`/events/${e.id}/summary`, { ...f, finish: false }); toast({ kind: 'ok', text: 'Guardado' }); onSaved(); }}>Guardar</button><button className="btn primary" onClick={async () => { await put(`/events/${e.id}/summary`, { ...f, finish: true }); onSaved(); }}>Guardar y finalizar</button></div>}
      </div>
      <div className="card stack">
        <h3>Pasajes trabajados</h3>
        {e.passages.map((x: any) => <div key={x.id} className="row small"><span className="grow">{x.marcha_title} · c.{x.measure_from ?? '?'}–{x.measure_to ?? '?'} {x.note ? `· ${x.note}` : ''}</span>{canEdit && <button className="btn sm ghost" onClick={async () => { await del(`/events/${e.id}/passages/${x.id}`); onSaved(); }}><Trash2 size={13} /></button>}</div>)}
        {canEdit && <div className="row nowrap"><select className="input" value={p.marcha_id} onChange={(x) => setP({ ...p, marcha_id: x.target.value })}><option value="">Marcha…</option>{marchas.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select><input className="input" style={{ width: 70 }} placeholder="c." value={p.from} onChange={(x) => setP({ ...p, from: x.target.value })} /><input className="input" style={{ width: 70 }} placeholder="a" value={p.to} onChange={(x) => setP({ ...p, to: x.target.value })} /><button className="btn" disabled={!p.marcha_id} onClick={async () => { await post(`/events/${e.id}/passages`, { marcha_id: p.marcha_id, measure_from: Number(p.from) || null, measure_to: Number(p.to) || null, note: p.note || null }); setP({ marcha_id: '', from: '', to: '', note: '' }); onSaved(); }}><Plus size={15} /></button></div>}
        <div className="sep" />
        <strong className="small">Comparación entre ensayos: pasajes trabajados repetidamente</strong>
        {(repeated.data ?? []).map((r, i) => <div key={i} className="small"><span className="badge warn">{r.times} ensayos</span> {r.title} · c.{r.measure_from}–{r.measure_to}<div className="xs muted">{r.sessions.map((s: any) => `${fmtDate(s.date)}${s.note ? ` (${s.note})` : ''}`).join(' · ')}</div></div>)}
        {!repeated.data?.length && <p className="small muted">Todavía no hay pasajes repetidos entre ensayos.</p>}
      </div>
    </div>
  );
}

function QrPanel({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [img, setImg] = useState('');
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const [left, setLeft] = useState(0);
  useEffect(() => { post(`/events/${eventId}/checkin/open`, { open: true }).then(() => setOpen(true)).catch((e) => setErr(e.message)); }, [eventId]);
  useEffect(() => {
    if (!open) return;
    let t: number;
    const tick = async () => {
      try {
        const r = await get(`/events/${eventId}/checkin/code`);
        setImg(await QRCode.toDataURL(`${location.origin}/checkin/${eventId}?c=${r.code}`, { width: 420, margin: 1 }));
        setLeft(Math.round(r.expiresIn / 1000));
        t = window.setTimeout(tick, Math.max(1000, r.expiresIn + 200));
      } catch (e) { setErr((e as Error).message); }
    };
    tick();
    const c = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000);
    return () => { clearTimeout(t); clearInterval(c); };
  }, [open, eventId]);
  return (
    <Modal title="Registro de presencia por QR" onClose={async () => { await post(`/events/${eventId}/checkin/open`, { open: false }).catch(() => {}); onClose(); }}>
      <div className="stack" style={{ alignItems: 'center' }}>
        {err && <Notice kind="danger">{err}</Notice>}
        {img ? <img src={img} alt="Código QR de asistencia" style={{ width: 'min(360px, 80vw)', background: '#fff', borderRadius: 16, padding: 10 }} /> : <Spinner />}
        <p className="small muted" style={{ textAlign: 'center' }}>Los componentes escanean el código con la cámara del móvil. El código cambia cada 20 s ({left} s), solo funciona durante el evento y cada persona se registra una sola vez. Al cerrar esta ventana se desactiva.</p>
      </div>
    </Modal>
  );
}

function AttLog({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const l = useLoad(() => get<any[]>(`/events/${eventId}/attendance/log`), [eventId]);
  return (
    <Modal title="Historial de asistencia" onClose={onClose}>
      <div className="stack sm">{(l.data ?? []).map((x) => <div key={x.id} className="small"><span className="faint">{fmtDateTime(x.at)}</span> · {x.user_name}: {x.old_status ? ATT_LABEL[x.old_status] : '—'} → <strong>{ATT_LABEL[x.new_status]}</strong> · {x.changed_by_name} ({x.method})</div>)}
        {!l.data?.length && <p className="muted small">Sin cambios registrados.</p>}</div>
    </Modal>
  );
}
