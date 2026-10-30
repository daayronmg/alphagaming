import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Mail, Phone, Music, KeyRound, Link2, Save, History, Shield, Lock } from '../components/icons';
import { get, put, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Spinner, ErrorBox, Field, Notice, Modal, useToast } from '../components/ui';
import { initials, assignmentLabel, fmtDate, fmtDateTime } from '../lib/format';
import { AssignmentEditor } from './Members';
import { fileUrl } from '../lib/api';

export default function MemberDetail() {
  const { id } = useParams();
  const { can, catalog, me } = useAuth();
  const toast = useToast();
  const m = useLoad(() => get(`/members/${id}`), [id]);
  const [assign, setAssign] = useState<any[] | null>(null);
  const [link, setLink] = useState<string | null>(null);
  if (m.error) return <div className="page"><ErrorBox error={m.error} /></div>;
  if (!m.data) return <Spinner />;
  const x = m.data;
  const manage = can('members.manage');
  const isDirector = me?.role === 'director';
  const save = async (body: any) => { try { await put(`/members/${id}`, body); toast({ kind: 'ok', text: 'Guardado' }); m.reload(); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } };
  return (
    <div className="page stack lg">
      <div className="hero row">
        <div className="avatar" style={{ width: 72, height: 72, fontSize: '1.4rem' }}>{x.photo_file_id ? <img src={fileUrl(x.photo_file_id)} alt="" /> : initials(x.name)}</div>
        <div className="grow stack sm">
          <h1>{x.name}</h1>
          <div className="row" style={{ gap: 6 }}>
            <span className="badge accent">{x.role === 'director' ? 'Dirección musical' : x.role === 'leader' ? 'Responsable de sección' : 'Componente'}</span>
            {x.status !== 'active' && <span className="badge warn">{x.status === 'baja' ? `Baja${x.left_at ? ' desde ' + fmtDate(x.left_at) : ''}` : 'Pendiente de activar'}</span>}
            {x.joined_at && <span className="badge">Desde {fmtDate(x.joined_at)}</span>}
            {x.assignments.map((a: any) => <span key={a.id} className="badge"><Music size={11} /> {assignmentLabel(a)}{a.is_default ? ' (principal)' : ''}</span>)}
          </div>
          <div className="row small muted">{x.email && <span><Mail size={13} /> {x.email}</span>}{x.phone && <span><Phone size={13} /> {x.phone}</span>}{!x.email && <span className="xs faint"><Lock size={12} /> Contacto no compartido</span>}</div>
        </div>
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card stack">
          <div className="card-title"><h3><Music size={18} /> Asignación musical</h3>{can('assignments.manage') && !assign && <button className="btn sm" onClick={() => setAssign(x.assignments.map((a: any) => ({ instrument_id: a.instrument_id, voice_id: a.voice_id, is_default: a.is_default })))}>Modificar</button>}</div>
          {!assign ? (x.assignments.length ? x.assignments.map((a: any) => <div key={a.id} className="small">{a.section} · {assignmentLabel(a)} {a.is_default && <span className="badge ok">se abre por defecto</span>}</div>) : <Notice kind="warn">Sin asignación: este componente no recibirá ninguna parte automáticamente.</Notice>)
            : <AssignChange id={id!} value={assign} onChange={setAssign} onDone={() => { setAssign(null); m.reload(); }} />}
          {x.assignment_changes?.length > 0 && <details><summary className="small muted"><History size={13} /> Historial de cambios ({x.assignment_changes.length})</summary>
            <div className="stack sm" style={{ marginTop: 8 }}>{x.assignment_changes.map((c: any) => (
              <div key={c.id} className="small row">
                <span className={`badge ${c.status === 'aplicado' ? 'ok' : c.status === 'pendiente' ? 'warn' : ''}`}>{c.status}</span>
                <span className="grow">{fmtDateTime(c.created_at)} · {c.reason ?? ''}{c.effective_from ? ` · efectivo ${fmtDate(c.effective_from)}` : ''} · {c.requested_by_name ?? 'sistema'}</span>
                {c.status === 'pendiente' && can('assignments.manage') && <><button className="btn sm" onClick={async () => { await post(`/members/assignment-changes/${c.id}/apply`); m.reload(); }}>Confirmar</button><button className="btn sm ghost" onClick={async () => { await post(`/members/assignment-changes/${c.id}/cancel`); m.reload(); }}>Cancelar</button></>}
              </div>))}</div></details>}
        </div>

        {x.attendance && (
          <div className="card stack">
            <h3>Asistencia y formación</h3>
            <div className="grid cols-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {['presente', 'retraso', 'ausente', 'justificada'].map((k) => <div key={k} className="stat"><span className="v" style={{ fontSize: '1.5rem' }}>{x.attendance[k]}</span><span className="l">{k}</span></div>)}
            </div>
            {x.courses?.map((c: any) => <div key={c.title} className="stack sm"><div className="row between small"><span>{c.title}</span><span>{c.done}/{c.lessons}</span></div><div className="bar"><i style={{ width: `${c.lessons ? c.done / c.lessons * 100 : 0}%` }} /></div></div>)}
            {x.repertoire?.length > 0 && <p className="small muted">Marchas consultadas: {x.repertoire.map((r: any) => r.title).join(', ')}</p>}
            <p className="xs faint">Datos de actividad en la app. No valoran la calidad musical.</p>
          </div>
        )}

        {manage && x.role !== 'director' && (
          <div className="card stack">
            <h3><Shield size={18} /> Cuenta y permisos</h3>
            <div className="form-grid">
              <Field label="Rol"><select className="input" value={x.role} onChange={(e) => save({ role: e.target.value })}><option value="member">Componente</option><option value="leader">Responsable</option></select></Field>
              <Field label="Estado"><select className="input" value={x.status} onChange={(e) => save({ status: e.target.value })}><option value="active">Activo</option><option value="inactive">Pendiente / inactivo</option><option value="baja">Baja</option></select></Field>
            </div>
            {isDirector && <Field label="Permisos especiales">
              <div className="stack sm">{Object.entries(catalog.global).map(([k, v]) => (
                <label key={k} className="checkbox small"><input type="checkbox" checked={x.permissions?.includes(k)} onChange={(e) => save({ permissions: e.target.checked ? [...(x.permissions ?? []), k] : x.permissions.filter((p: string) => p !== k) })} /> {v}</label>
              ))}</div>
            </Field>}
            <div className="row">
              <button className="btn sm" onClick={async () => { const r = await post(`/members/${id}/invitation`); setLink(r.link); }}><Link2 size={14} /> Enlace de activación</button>
              <button className="btn sm" onClick={async () => { const r = await post(`/members/${id}/reset-link`); setLink(r.link); }}><KeyRound size={14} /> Enlace para nueva contraseña</button>
            </div>
            {x.last_login_at && <p className="xs faint">Último acceso: {fmtDateTime(x.last_login_at)}</p>}
          </div>
        )}

        {manage && x.private_notes && (
          <div className="card stack">
            <h3><Lock size={18} /> Observaciones internas</h3>
            <p className="xs faint">Solo visibles para la dirección y quien tenga permiso de gestión de componentes.</p>
            <PrivateNotes id={id!} initial={x.private_notes.notes} />
          </div>
        )}
      </div>
      {link && <Modal title="Enlace generado" onClose={() => setLink(null)}><div className="stack"><Notice kind="warn">Compártelo solo con esta persona por un canal privado.</Notice><input className="input mono" readOnly value={link} onFocus={(e) => e.target.select()} /><button className="btn" onClick={() => navigator.clipboard?.writeText(link)}>Copiar</button></div></Modal>}
    </div>
  );
}

function AssignChange({ id, value, onChange, onDone }: { id: string; value: any[]; onChange: (v: any[]) => void; onDone: () => void }) {
  const toast = useToast();
  const [apply, setApply] = useState<'ahora' | 'fecha' | 'confirmar'>('ahora');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  return (
    <div className="stack">
      <AssignmentEditor value={value} onChange={onChange} />
      <div className="form-grid">
        <Field label="Aplicar"><select className="input" value={apply} onChange={(e) => setApply(e.target.value as any)}><option value="ahora">Ahora</option><option value="fecha">A partir de una fecha</option><option value="confirmar">Dejar pendiente de confirmar</option></select></Field>
        {apply === 'fecha' && <Field label="Fecha"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
        <Field label="Motivo"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cambio de voz…" /></Field>
      </div>
      <div className="row"><button className="btn" onClick={onDone}>Cancelar</button><button className="btn primary" onClick={async () => { try { await post(`/members/${id}/assignments`, { assignments: value, apply, effective_from: date || null, reason: reason || undefined }); toast({ kind: 'ok', text: apply === 'ahora' ? 'Asignación aplicada' : 'Cambio registrado' }); onDone(); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } }}><Save size={14} /> Guardar cambio</button></div>
    </div>
  );
}

function PrivateNotes({ id, initial }: { id: string; initial: string }) {
  const toast = useToast();
  const [t, setT] = useState(initial);
  return <><textarea className="input" value={t} onChange={(e) => setT(e.target.value)} /><button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={t === initial} onClick={async () => { await put(`/members/${id}/notes`, { notes: t }); toast({ kind: 'ok', text: 'Guardado' }); }}>Guardar</button></>;
}
