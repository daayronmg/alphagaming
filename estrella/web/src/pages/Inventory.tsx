import { useState } from 'react';
import { Package, Plus, Pencil, Trash2 } from '../components/icons';
import { get, post, put, del } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Modal, Field, useToast, Empty, Tabs } from '../components/ui';

const KINDS = { instrumento: 'Instrumentos', uniforme: 'Uniformidad', material: 'Material' } as const;
const COND: Record<string, string> = { nuevo: 'Nuevo', bueno: 'Bueno', regular: 'Regular', reparacion: 'En reparación', baja: 'Baja' };

export default function Inventory() {
  const { can } = useAuth();
  const toast = useToast();
  const list = useLoad(() => get<any[]>('/inventory'), []);
  const members = useLoad(() => get<any[]>('/members'), []);
  const [kind, setKind] = useState<keyof typeof KINDS>('instrumento');
  const [edit, setEdit] = useState<any | null>(null);
  const manage = can('members.manage');
  const rows = (list.data ?? []).filter((i) => i.kind === kind);
  const save = async () => {
    try {
      const body = { kind: edit.kind, name: edit.name, code: edit.code || null, size: edit.size || null, condition: edit.condition, assigned_to: edit.assigned_to || null, notes: edit.notes || null };
      if (edit.id) await put(`/inventory/${edit.id}`, body); else await post('/inventory', body);
      setEdit(null); list.reload();
    } catch (e) { toast({ kind: 'error', text: (e as Error).message }); }
  };
  return (
    <div className="page">
      <div className="page-head"><div><div className="eyebrow">Intendencia</div><h1>Material y uniformidad</h1></div>
        <div className="row"><Tabs value={kind} onChange={setKind} items={Object.entries(KINDS).map(([k, v]) => ({ value: k as any, label: v }))} />{manage && <button className="btn primary" onClick={() => setEdit({ kind, name: '', condition: 'bueno' })}><Plus size={16} /> Añadir</button>}</div></div>
      {list.data && !rows.length && <Empty icon={<Package size={36} />} title="Sin registros" />}
      {rows.length > 0 && <div className="card"><div className="table-wrap"><table className="table">
        <thead><tr><th>Elemento</th><th>Código</th><th>Talla</th><th>Estado</th><th>Asignado a</th><th>Notas</th><th /></tr></thead>
        <tbody>{rows.map((i) => <tr key={i.id}><td>{i.name}</td><td className="mono small">{i.code ?? '—'}</td><td>{i.size ?? '—'}</td><td><span className={`badge ${i.condition === 'reparacion' ? 'warn' : i.condition === 'baja' ? 'danger' : 'ok'}`}>{COND[i.condition]}</span></td><td>{i.assigned_name ?? '—'}</td><td className="small muted">{i.notes}</td>
          <td>{manage && <div className="row"><button className="btn sm icon" onClick={() => setEdit(i)}><Pencil size={14} /></button><button className="btn sm icon" onClick={async () => { if (confirm('¿Eliminar?')) { await del(`/inventory/${i.id}`); list.reload(); } }}><Trash2 size={14} /></button></div>}</td></tr>)}</tbody>
      </table></div></div>}
      {edit && <Modal title={edit.id ? 'Editar' : 'Añadir'} onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancelar</button><button className="btn primary" disabled={!edit.name} onClick={save}>Guardar</button></>}>
        <div className="form-grid">
          <Field label="Tipo"><select className="input" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Nombre"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Código / nº de serie"><input className="input" value={edit.code ?? ''} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
          <Field label="Talla"><input className="input" value={edit.size ?? ''} onChange={(e) => setEdit({ ...edit, size: e.target.value })} /></Field>
          <Field label="Estado"><select className="input" value={edit.condition} onChange={(e) => setEdit({ ...edit, condition: e.target.value })}>{Object.entries(COND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Asignado a"><select className="input" value={edit.assigned_to ?? ''} onChange={(e) => setEdit({ ...edit, assigned_to: e.target.value })}><option value="">Almacén</option>{(members.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
        </div>
        <div style={{ marginTop: 12 }}><Field label="Notas"><textarea className="input" value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field></div>
      </Modal>}
    </div>
  );
}
