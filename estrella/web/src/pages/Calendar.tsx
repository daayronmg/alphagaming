import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, List, CalendarDays } from '../components/icons';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Modal, Field, useToast, Tabs, Empty } from '../components/ui';
import { useRealtime } from '../lib/realtime';
import { EVENT_TYPES, fmtDate, fmtTime, toLocalInput, fromLocalInput } from '../lib/format';

const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export default function Calendar() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [view, setView] = useState<'mes' | 'lista'>(() => (window.innerWidth < 700 ? 'lista' : 'mes'));
  const [creating, setCreating] = useState(sp.get('nuevo') === '1');
  const from = new Date(month.getFullYear(), month.getMonth(), 1 - 7);
  const to = new Date(month.getFullYear(), month.getMonth() + 1, 7);
  const ev = useLoad(() => get<any[]>(`/events?from=${from.toISOString()}&to=${to.toISOString()}`), [month.getTime()]);
  useRealtime((m) => { if (m.t === 'events:changed') ev.reload(); }, []);
  useEffect(() => { if (!creating && sp.get('nuevo')) setSp({}); }, [creating]); // eslint-disable-line

  const start = new Date(month); const off = (start.getDay() + 6) % 7; start.setDate(start.getDate() - off);
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const list = (ev.data ?? []).filter((e) => new Date(e.starts_at).getMonth() === month.getMonth());

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Agenda de la banda</div><h1>Calendario</h1></div>
        <div className="row">
          <Tabs value={view} onChange={setView} items={[{ value: 'mes', label: <CalendarDays size={16} /> }, { value: 'lista', label: <List size={16} /> }]} />
          {can('events.manage') && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={18} /> Nuevo evento</button>}
        </div>
      </div>
      <div className="row between" style={{ marginBottom: 14 }}>
        <button className="btn icon" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Mes anterior"><ChevronLeft size={18} /></button>
        <h2 style={{ textTransform: 'capitalize' }}>{month.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}</h2>
        <button className="btn icon" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Mes siguiente"><ChevronRight size={18} /></button>
      </div>
      {view === 'mes' ? (
        <div className="cal">
          {DOW.map((d) => <div key={d} className="dow">{d}</div>)}
          {days.map((d) => (
            <div key={d.toISOString()} className={`day ${d.getMonth() !== month.getMonth() ? 'other' : ''} ${same(d, new Date()) ? 'today' : ''}`}>
              <span className="faint">{d.getDate()}</span>
              {(ev.data ?? []).filter((e) => same(new Date(e.starts_at), d)).map((e) => (
                <Link key={e.id} to={`/eventos/${e.id}`} className={`ev ${e.type}`} title={e.title} style={e.status === 'cancelado' ? { textDecoration: 'line-through', opacity: .6 } : undefined}>{fmtTime(e.starts_at)} {e.title}</Link>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="stack sm">
          {!list.length && <Empty title="Sin eventos este mes" />}
          {list.map((e) => (
            <Link key={e.id} to={`/eventos/${e.id}`} className="card flat tight row">
              <div style={{ textAlign: 'center', minWidth: 56 }}><div className="xs faint">{fmtDate(e.starts_at).split(' ')[0]}</div><div style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', fontWeight: 700 }}>{new Date(e.starts_at).getDate()}</div></div>
              <div className="grow">
                <div style={{ fontWeight: 650 }}>{e.title} {e.status === 'cancelado' && <span className="badge danger">Cancelado</span>}</div>
                <div className="xs muted">{EVENT_TYPES[e.type]} · {fmtTime(e.starts_at)}{e.location ? ` · ${e.location}` : ''}</div>
              </div>
              {e.my_rsvp && <span className={`badge ${e.my_rsvp === 'asistire' ? 'ok' : 'danger'}`}>{e.my_rsvp === 'asistire' ? 'Asistiré' : 'No asistiré'}</span>}
              {e.live && <span className="badge accent">En directo</span>}
            </Link>
          ))}
        </div>
      )}
      {creating && <EventForm onClose={() => setCreating(false)} onSaved={() => { setCreating(false); ev.reload(); }} />}
    </div>
  );
}

export function EventForm({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const struct = useLoad(() => get<any[]>('/org/structure'), []);
  const members = useLoad(() => get<any[]>('/members'), []);
  const lib = useLoad(() => get<any[]>('/library/marchas'), []);
  const tomorrow = new Date(Date.now() + 86400000); tomorrow.setHours(20, 30, 0, 0);
  const [f, setF] = useState<any>(() => initial ? { ...initial, starts_at: toLocalInput(initial.starts_at), call_at: toLocalInput(initial.call_at), ends_at: toLocalInput(initial.ends_at), repertoire: initial.repertoire?.map((m: any) => m.id) ?? [] }
    : { type: 'ensayo', title: 'Ensayo', starts_at: toLocalInput(tomorrow), call_at: toLocalInput(new Date(tomorrow.getTime() - 15 * 60000)), ends_at: toLocalInput(new Date(tomorrow.getTime() + 2 * 3600000)), location: '', uniform: '', notes: '', responsible_id: '', section_ids: [], repertoire: [] });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const body = { type: f.type, title: f.title, starts_at: fromLocalInput(f.starts_at), call_at: fromLocalInput(f.call_at), ends_at: fromLocalInput(f.ends_at), location: f.location || null, uniform: f.uniform || null, notes: f.notes || null, responsible_id: f.responsible_id || null, section_ids: f.section_ids, repertoire: f.repertoire, ...(initial ? { status: f.status } : {}) };
    try {
      if (initial) { await (await import('../lib/api')).put(`/events/${initial.id}`, body); onSaved(initial.id); }
      else { const r = await post('/events', body); toast({ kind: 'ok', text: 'Evento creado' }); onSaved(r.id); nav(`/eventos/${r.id}`); }
    } catch (e) { toast({ kind: 'error', text: (e as Error).message }); }
  };
  return (
    <Modal title={initial ? 'Editar evento' : 'Nuevo evento'} wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save} disabled={!f.title || !f.starts_at} data-testid="event-save">Guardar</button></>}>
      <div className="stack">
        <div className="form-grid">
          <Field label="Tipo"><select className="input" value={f.type} onChange={set('type')}>{Object.entries(EVENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Título"><input className="input" value={f.title} onChange={set('title')} /></Field>
          <Field label="Hora de convocatoria"><input className="input" type="datetime-local" value={f.call_at} onChange={set('call_at')} /></Field>
          <Field label="Hora de inicio"><input className="input" type="datetime-local" value={f.starts_at} onChange={set('starts_at')} /></Field>
          <Field label="Fin (aprox.)"><input className="input" type="datetime-local" value={f.ends_at} onChange={set('ends_at')} /></Field>
          <Field label="Lugar"><input className="input" value={f.location ?? ''} onChange={set('location')} /></Field>
          <Field label="Responsable"><select className="input" value={f.responsible_id ?? ''} onChange={set('responsible_id')}><option value="">—</option>{(members.data ?? []).filter((m) => m.role !== 'member').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
          {initial && <Field label="Estado"><select className="input" value={f.status} onChange={set('status')}><option value="programado">Programado</option><option value="cancelado">Cancelado</option><option value="finalizado">Finalizado</option></select></Field>}
        </div>
        <Field label="Secciones convocadas (ninguna = toda la banda)">
          <div className="chips">{(struct.data ?? []).map((s) => <button key={s.id} type="button" className={`chip ${f.section_ids.includes(s.id) ? 'on' : ''}`} onClick={() => setF({ ...f, section_ids: f.section_ids.includes(s.id) ? f.section_ids.filter((x: number) => x !== s.id) : [...f.section_ids, s.id] })}>{s.name}</button>)}</div>
        </Field>
        <Field label="Repertorio">
          <div className="chips">{(lib.data ?? []).map((m) => <button key={m.id} type="button" className={`chip ${f.repertoire.includes(m.id) ? 'on' : ''}`} onClick={() => setF({ ...f, repertoire: f.repertoire.includes(m.id) ? f.repertoire.filter((x: string) => x !== m.id) : [...f.repertoire, m.id] })}>{m.title}</button>)}</div>
        </Field>
        <Field label="Uniformidad o material necesario"><input className="input" value={f.uniform ?? ''} onChange={set('uniform')} /></Field>
        <Field label="Indicaciones"><textarea className="input" value={f.notes ?? ''} onChange={set('notes')} /></Field>
        {initial && <p className="xs muted">Si cambias hora o lugar de un evento de los próximos 3 días, se enviará un aviso urgente de cambio de última hora.</p>}
      </div>
    </Modal>
  );
}
