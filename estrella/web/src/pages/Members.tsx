import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, UserPlus, Upload, Download, Users, Mail, Phone } from '../components/icons';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Modal, Field, useToast, Notice, Spinner } from '../components/ui';
import { initials, assignmentLabel } from '../lib/format';
import { fileUrl } from '../lib/api';

export default function Members() {
  const { can } = useAuth();
  const manage = can('members.manage');
  const [q, setQ] = useState('');
  const [sec, setSec] = useState('');
  const [all, setAll] = useState(false);
  const [eventId, setEventId] = useState('');
  const [rsvpFilter, setRsvpFilter] = useState('');
  const list = useLoad(() => get<any[]>(`/members${all ? '?all=1' : ''}`), [all]);
  const struct = useLoad(() => get<any[]>('/org/structure'), []);
  const events = useLoad(() => get<any[]>('/events'), []);
  const ev = useLoad(() => (eventId ? get(`/events/${eventId}`) : Promise.resolve(null)), [eventId]);
  const [creating, setCreating] = useState(false);
  const rsvpOf = (id: string) => ev.data?.roster?.find((r: any) => r.id === id)?.rsvp?.response ?? (ev.data?.roster?.some((r: any) => r.id === id) ? 'pendiente' : null);
  const rows = (list.data ?? []).filter((m) =>
    (!q || m.name.toLowerCase().includes(q.toLowerCase())) && (!sec || m.section_ids.includes(Number(sec))) &&
    (!eventId || !rsvpFilter || rsvpOf(m.id) === rsvpFilter));
  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Plantilla</div><h1>Componentes</h1></div>
        {manage && <div className="row">
          <a className="btn" href="/api/members/export/csv"><Download size={16} /> Exportar</a>
          <Link className="btn" to="/componentes/importar"><Upload size={16} /> Importar CSV / Excel</Link>
          <button className="btn primary" onClick={() => setCreating(true)}><UserPlus size={16} /> Nuevo componente</button>
        </div>}
      </div>
      <div className="card flat row" style={{ marginBottom: 16 }}>
        <Search size={18} className="faint" /><input className="input" style={{ maxWidth: 260 }} placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: 'auto' }} value={sec} onChange={(e) => setSec(e.target.value)}><option value="">Todas las secciones</option>{(struct.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <select className="input" style={{ width: 'auto' }} value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">Confirmación de…</option>{(events.data ?? []).filter((e) => new Date(e.starts_at) > new Date()).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select>
        {eventId && <select className="input" style={{ width: 'auto' }} value={rsvpFilter} onChange={(e) => setRsvpFilter(e.target.value)}><option value="">Todos</option><option value="asistire">Han confirmado</option><option value="no_asistire">No asistirán</option><option value="pendiente">Sin responder (necesitan aviso)</option></select>}
        {manage && <label className="checkbox"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Incluir inactivos y bajas</label>}
        <span className="grow" /><span className="small muted"><Users size={14} style={{ verticalAlign: -2 }} /> {rows.length}</span>
      </div>
      {!list.data ? <Spinner /> : (
        <div className="grid cols-3">
          {rows.map((m) => (
            <Link key={m.id} to={`/componentes/${m.id}`} className="card hover row nowrap" style={{ alignItems: 'flex-start' }}>
              <div className="avatar" style={{ width: 46, height: 46 }}>{m.photo_file_id ? <img src={fileUrl(m.photo_file_id)} alt="" /> : initials(m.name)}</div>
              <div className="grow stack sm" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}><strong className="ellipsis">{m.name}</strong>{m.role !== 'member' && <span className="badge accent">{m.role === 'director' ? 'Dirección' : 'Responsable'}</span>}{m.status !== 'active' && <span className="badge warn">{m.status === 'baja' ? 'Baja' : 'Pendiente'}</span>}{m.is_demo && <span className="badge">demo</span>}</div>
                <div className="xs muted">{m.assignments.length ? m.assignments.map(assignmentLabel).join(' / ') : 'Sin asignación'}</div>
                {(m.email || m.phone) && <div className="xs faint row" style={{ gap: 8 }}>{m.email && <span><Mail size={11} /> {m.email}</span>}{m.phone && <span><Phone size={11} /> {m.phone}</span>}</div>}
                {eventId && rsvpOf(m.id) && <span className={`badge ${rsvpOf(m.id) === 'asistire' ? 'ok' : rsvpOf(m.id) === 'no_asistire' ? 'danger' : 'warn'}`}>{rsvpOf(m.id)}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
      <p className="xs faint" style={{ marginTop: 14 }}>Los datos de contacto solo se muestran a la dirección, a los responsables de la sección o si el componente ha decidido compartirlos.</p>
      {creating && <NewMember onClose={() => setCreating(false)} onDone={() => { setCreating(false); list.reload(); }} />}
    </div>
  );
}

export function AssignmentEditor({ value, onChange }: { value: { instrument_id: number; voice_id: number | null; is_default: boolean }[]; onChange: (v: any[]) => void }) {
  const struct = useLoad(() => get<any[]>('/org/structure'), []);
  const insts = (struct.data ?? []).flatMap((s) => s.instruments.map((i: any) => ({ ...i, section: s.name })));
  return (
    <div className="stack sm">
      {value.map((a, i) => {
        const inst = insts.find((x) => x.id === a.instrument_id);
        return (
          <div key={i} className="row nowrap">
            <input type="radio" name="default" checked={a.is_default} onChange={() => onChange(value.map((x, j) => ({ ...x, is_default: j === i })))} title="Parte que se abre por defecto" />
            <select className="input" value={a.instrument_id} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, instrument_id: Number(e.target.value), voice_id: null } : x)))}>{insts.map((x) => <option key={x.id} value={x.id}>{x.section} · {x.name}</option>)}</select>
            <select className="input" value={a.voice_id ?? ''} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, voice_id: e.target.value ? Number(e.target.value) : null } : x)))}><option value="">{inst?.voices.length ? 'Común' : 'Sin voces'}</option>{(inst?.voices ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
            <button className="btn sm ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}>Quitar</button>
          </div>
        );
      })}
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={!insts.length} onClick={() => onChange([...value, { instrument_id: insts[0].id, voice_id: null, is_default: !value.length }])}>+ Añadir instrumento / voz</button>
      <p className="xs faint">El botón redondo marca la parte que se abrirá por defecto en cada ensayo.</p>
    </div>
  );
}

function NewMember({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', role: 'member', phone: '' });
  const [as, setAs] = useState<any[]>([]);
  const [inv, setInv] = useState<string | null>(null);
  if (inv) return <Modal title="Componente creado" onClose={onDone}><div className="stack"><Notice kind="ok">Envía este enlace a la persona para que active su cuenta con su propia contraseña (válido 30 días):</Notice><input className="input mono" readOnly value={inv} onFocus={(e) => e.target.select()} /><button className="btn" onClick={() => navigator.clipboard?.writeText(inv)}>Copiar enlace</button></div></Modal>;
  return (
    <Modal title="Nuevo componente" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!f.name || !f.email} onClick={async () => { try { const r = await post('/members', { ...f, phone: f.phone || null, status: 'inactive', assignments: as }); setInv(r.invitation.link); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } }}>Crear y generar invitación</button></>}>
      <div className="stack">
        <div className="form-grid">
          <Field label="Nombre y apellidos"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Correo electrónico"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Rol"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="member">Componente</option><option value="leader">Responsable de sección</option></select></Field>
          <Field label="Teléfono (opcional)"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        <Field label="Asignación musical"><AssignmentEditor value={as} onChange={setAs} /></Field>
        <p className="xs faint">El correo identifica la cuenta, pero no concede permisos: el rol y los permisos los fija la dirección.</p>
      </div>
    </Modal>
  );
}
