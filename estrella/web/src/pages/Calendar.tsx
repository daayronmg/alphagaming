import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Plus } from '../components/icons';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Modal, Field, useToast } from '../components/ui';
import { useRealtime } from '../lib/realtime';
import { Sheet, SheetOption } from '../components/Sheet';
import { IcoEnsayo, IcoActuacion, IcoOtro } from '../components/SheetIcons';
import { EVENT_TYPES, ATT_LABEL, fmtTime, toLocalInput, fromLocalInput } from '../lib/format';

const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const FILTERS = [
  { v: 'todos', l: 'Todos' }, { v: 'actuaciones', l: 'Actuaciones' }, { v: 'ensayos', l: 'Ensayos' }, { v: 'otros', l: 'Otros' },
] as const;
type Filter = typeof FILTERS[number]['v'];
const ofFilter = (t: string, f: Filter) => f === 'todos' || (f === 'ensayos' ? t === 'ensayo' : f === 'otros' ? t === 'otro' : ['actuacion', 'concierto', 'procesion'].includes(t));
const mondayOf = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const monthLabel = (d: Date) => { const m = d.toLocaleDateString('es-ES', { month: 'long' }); return `${m[0].toUpperCase()}${m.slice(1)} ${d.getFullYear()}`; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Agenda: semana arriba (se despliega al mes), anteriores / próximos y filtros por tipo. */
export default function Calendar() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [when, setWhen] = useState<'proximos' | 'anteriores'>('proximos');
  const [filter, setFilter] = useState<Filter>('todos');
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState<Date | null>(null);
  const [creating, setCreating] = useState(sp.get('nuevo') === '1');
  const [choose, setChoose] = useState(false);
  const [preset, setPreset] = useState<{ type: string; title: string } | undefined>();
  const now = new Date();
  // Un año hacia atrás y uno hacia delante: todo lo que la agenda puede enseñar
  const ev = useLoad(() => get<any[]>(`/events?from=${addDays(now, -366).toISOString()}&to=${addDays(now, 366).toISOString()}`), []);
  useRealtime((m) => { if (m.t === 'events:changed') ev.reload(); }, []);
  useEffect(() => { if (!creating && sp.get('nuevo')) setSp({}); }, [creating]); // eslint-disable-line

  const all = (ev.data ?? []).filter((e) => ofFilter(e.type, filter));
  const hasEv = (d: Date) => all.some((e) => same(new Date(e.starts_at), d));
  const list = day
    ? all.filter((e) => same(new Date(e.starts_at), day))
    : when === 'proximos'
      ? all.filter((e) => new Date(e.starts_at) >= new Date(now.toDateString()))
      : all.filter((e) => new Date(e.starts_at) < new Date(now.toDateString())).reverse();
  const month = new Date(week.getFullYear(), week.getMonth() + (week.getDate() > 24 ? 1 : 0), 1);
  const grid = Array.from({ length: 42 }, (_, i) => addDays(mondayOf(month), i));
  const pick = (d: Date) => { setDay(day && same(day, d) ? null : d); setWeek(mondayOf(d)); };
  const dayCell = (d: Date, other = false) => (
    <button key={d.toISOString()} type="button" className={`ag-day ${same(d, now) ? 'today' : ''} ${day && same(d, day) ? 'sel' : ''} ${other ? 'other' : ''}`} onClick={() => pick(d)} aria-label={d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}>
      <span>{d.getDate()}</span>{hasEv(d) && <i />}
    </button>
  );
  const groups: { key: string; date: Date; items: any[] }[] = [];
  for (const e of list) { const d = new Date(e.starts_at); const k = d.toDateString(); const g = groups.find((x) => x.key === k); if (g) g.items.push(e); else groups.push({ key: k, date: d, items: [e] }); }

  return (
    <div className="page agenda">
      <div className="ag-head">
        <h1>Agenda</h1>
        <div className="ag-seg" role="tablist">
          {(['anteriores', 'proximos'] as const).map((w) => <button key={w} role="tab" aria-selected={!day && when === w} className={!day && when === w ? 'on' : ''} onClick={() => { setWhen(w); setDay(null); }}>{w === 'proximos' ? 'Próximos' : 'Anteriores'}</button>)}
        </div>
        {can('events.manage') && <button className="ag-add" onClick={() => setChoose(true)} aria-label="Nuevo evento" title="Nuevo evento"><Plus size={24} /></button>}
      </div>
      <div className="ag-week">
        {open && (
            <div className="ag-month-nav">
              <button className="btn icon ghost sm" onClick={() => setWeek(mondayOf(new Date(month.getFullYear(), month.getMonth() - 1, 1)))} aria-label="Mes anterior"><ChevronLeft size={18} /></button>
              <b>{monthLabel(month)}</b>
              <button className="btn icon ghost sm" onClick={() => setWeek(mondayOf(new Date(month.getFullYear(), month.getMonth() + 1, 1)))} aria-label="Mes siguiente"><ChevronRight size={18} /></button>
            </div>
        )}
        <div className="ag-dow">{DOW.map((d) => <span key={d}>{d}</span>)}</div>
        {open ? (
          <>
            <div className="ag-days">{grid.map((d) => dayCell(d, d.getMonth() !== month.getMonth()))}</div>
          </>
        ) : (
          <div className="ag-days row1">
            <button className="ag-arrow" onClick={() => setWeek(addDays(week, -7))} aria-label="Semana anterior"><ChevronLeft size={16} /></button>
            {Array.from({ length: 7 }, (_, i) => dayCell(addDays(week, i)))}
            <button className="ag-arrow r" onClick={() => setWeek(addDays(week, 7))} aria-label="Semana siguiente"><ChevronRight size={16} /></button>
          </div>
        )}
        <div className="ag-foot">
          <span>{open ? '' : monthLabel(week)}</span>
          <button className="ag-toggle" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? 'Ver solo la semana' : 'Ver el mes entero'}>{open ? <ChevronUp size={22} /> : <ChevronDown size={22} />}</button>
        </div>
      </div>
      <div className="ag-chips">
        {FILTERS.map((f) => <button key={f.v} className={filter === f.v ? 'on' : ''} onClick={() => setFilter(f.v)}>{f.l}</button>)}
        {day && <button className="on" onClick={() => setDay(null)}>{day.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} ✕</button>}
      </div>
      {ev.loading && !ev.data ? <p className="muted center">Cargando…</p> : !groups.length ? (
        <div className="ag-empty">
          <div className="ag-empty-ico" aria-hidden>📅</div>
          <h3>{day ? 'Nada este día' : when === 'proximos' ? 'No tienes eventos previstos' : 'No hay eventos anteriores'}</h3>
          <p className="muted">{day ? 'No hay actos ni ensayos ese día.' : when === 'proximos' ? 'Todavía no tienes actos o ensayos programados.' : 'Aquí verás los ensayos y actos que ya han pasado.'}</p>
        </div>
      ) : (
        <div className="ag-list">
          {groups.map((g) => (
            <section key={g.key}>
              <h4 className="ag-date">{same(g.date, now) ? 'Hoy' : same(g.date, addDays(now, 1)) ? 'Mañana' : g.date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</h4>
              {g.items.map((e) => <AgendaItem key={e.id} e={e} past={new Date(e.starts_at) < now} />)}
            </section>
          ))}
        </div>
      )}
      {choose && (
        <Sheet center title="Selecciona el tipo de evento" onClose={() => setChoose(false)}>
          <SheetOption icon={<IcoEnsayo />} title="Ensayo" text="Sesiones de práctica y preparación" onClick={() => { setPreset({ type: 'ensayo', title: 'Ensayo' }); setChoose(false); setCreating(true); }} />
          <SheetOption icon={<IcoActuacion />} title="Actuación" text="Procesiones, conciertos, actos y eventos en vivo" onClick={() => { setPreset({ type: 'actuacion', title: 'Actuación' }); setChoose(false); setCreating(true); }} />
          <SheetOption icon={<IcoOtro />} title="Otro" text="Reuniones, viajes u otros eventos del grupo" onClick={() => { setPreset({ type: 'otro', title: '' }); setChoose(false); setCreating(true); }} />
        </Sheet>
      )}
      {creating && <EventForm preset={preset} onClose={() => { setCreating(false); setPreset(undefined); }} onSaved={() => { setCreating(false); setPreset(undefined); ev.reload(); }} />}
    </div>
  );
}

function AgendaItem({ e, past }: { e: any; past: boolean }) {
  const kind = e.type === 'ensayo' ? 'ensayo' : e.type === 'otro' ? 'otro' : 'actuacion';
  const status = e.status === 'cancelado' ? <span className="badge danger">Cancelado</span>
    : e.live ? <span className="badge accent">En directo</span>
    : past ? (e.my_attendance ? <span className={`badge ${e.my_attendance === 'presente' ? 'ok' : e.my_attendance === 'ausente' ? 'danger' : ''}`}>{ATT_LABEL[e.my_attendance] ?? e.my_attendance}</span> : null)
    : e.my_rsvp ? <span className={`badge ${e.my_rsvp === 'asistire' ? 'ok' : 'danger'}`}>{e.my_rsvp === 'asistire' ? 'Voy' : 'No voy'}</span>
    : e.convoked ? <span className="badge warn">Confirma</span> : null;
  return (
    <Link to={`/eventos/${e.id}`} className={`ag-item ${kind} ${e.status === 'cancelado' ? 'off' : ''}`}>
      <div className="ag-time"><b>{fmtTime(e.call_at ?? e.starts_at)}</b>{e.call_at && <small>citación</small>}</div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="ag-title">{e.title}</div>
        <div className="xs muted ellipsis">{EVENT_TYPES[e.type]}{e.location ? ` · ${e.location}` : ''}</div>
      </div>
      {status}
    </Link>
  );
}

export function EventForm({ initial, preset, onClose, onSaved }: { initial?: any; preset?: { type: string; title: string }; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const struct = useLoad(() => get<any[]>('/org/structure'), []);
  const members = useLoad(() => get<any[]>('/members'), []);
  const lib = useLoad(() => get<any[]>('/library/marchas'), []);
  const tomorrow = new Date(Date.now() + 86400000); tomorrow.setHours(20, 30, 0, 0);
  const [f, setF] = useState<any>(() => initial ? { ...initial, starts_at: toLocalInput(initial.starts_at), call_at: toLocalInput(initial.call_at), ends_at: toLocalInput(initial.ends_at), repertoire: initial.repertoire?.map((m: any) => m.id) ?? [] }
    : { type: preset?.type ?? 'ensayo', title: preset?.title ?? 'Ensayo', starts_at: toLocalInput(tomorrow), call_at: toLocalInput(new Date(tomorrow.getTime() - 15 * 60000)), ends_at: toLocalInput(new Date(tomorrow.getTime() + 2 * 3600000)), location: '', uniform: '', notes: '', responsible_id: '', section_ids: [], repertoire: [] });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const body = { type: f.type, title: f.title, starts_at: fromLocalInput(f.starts_at), call_at: fromLocalInput(f.call_at), ends_at: fromLocalInput(f.ends_at), location: f.location || null, uniform: f.uniform || null, notes: f.notes || null, responsible_id: f.responsible_id || null, section_ids: f.section_ids, repertoire: f.repertoire, ...(initial ? { status: f.status } : {}) };
    try {
      if (initial) { await (await import('../lib/api')).put(`/events/${initial.id}`, body); onSaved(initial.id); }
      else { const r = await post('/events', body); toast({ kind: 'ok', text: 'Evento creado' }); onSaved(r.id); nav(`/eventos/${r.id}`); }
    } catch (e) { toast({ kind: 'error', text: (e as Error).message }); }
  };
  return (
    <Modal title={initial ? 'Editar evento' : preset ? `Nuevo: ${EVENT_TYPES[preset.type] ?? 'evento'}` : 'Nuevo evento'} wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={save} disabled={!f.title || !f.starts_at} data-testid="event-save">Guardar</button></>}>
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
