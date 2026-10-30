import { useState } from 'react';
import { Plus, Trash2, Save, Upload, Shield, Users, Palette, Music } from '../components/icons';
import { get, post, put, del, upload } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Tabs, Field, useToast, Notice, Spinner } from '../components/ui';
import { fmtDateTime } from '../lib/format';

export default function Admin() {
  const { me, can } = useAuth();
  const [tab, setTab] = useState<'estructura' | 'responsables' | 'identidad' | 'invitaciones'>('estructura');
  if (me?.role !== 'director' && !can('assignments.manage')) return <div className="page"><Notice kind="danger">Sin permiso.</Notice></div>;
  return (
    <div className="page stack lg">
      <div className="page-head"><div><div className="eyebrow">Configuración</div><h1>Administración</h1></div>
        <Tabs value={tab} onChange={setTab} items={[{ value: 'estructura', label: <><Music size={14} /> Estructura</> }, { value: 'responsables', label: <><Shield size={14} /> Responsables</> }, { value: 'identidad', label: <><Palette size={14} /> Identidad</> }, { value: 'invitaciones', label: <><Users size={14} /> Invitaciones</> }]} /></div>
      {tab === 'estructura' && <Structure />}
      {tab === 'responsables' && <Leaders />}
      {tab === 'identidad' && <Branding />}
      {tab === 'invitaciones' && <Invitations />}
    </div>
  );
}

function Structure() {
  const toast = useToast();
  const s = useLoad(() => get<any[]>('/org/structure'), []);
  const run = async (fn: () => Promise<any>) => { try { await fn(); s.reload(); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } };
  const [ns, setNs] = useState({ name: '', family: 'viento' });
  if (!s.data) return <Spinner />;
  return (
    <div className="stack">
      <Notice kind="info">Configura las secciones, instrumentos y voces reales de la banda. Las partituras y las asignaciones de cada componente se basan en esta estructura. «Transposición» = semitonos entre lo escrito y lo que suena (instrumento en Si♭: −2).</Notice>
      {s.data.map((sec) => (
        <div key={sec.id} className="card stack">
          <div className="row">
            <input type="color" value={sec.color} onChange={(e) => run(() => put(`/org/sections/${sec.id}`, { ...sec, color: e.target.value }))} aria-label="Color" />
            <input className="input" style={{ maxWidth: 240, fontWeight: 700 }} defaultValue={sec.name} onBlur={(e) => e.target.value !== sec.name && run(() => put(`/org/sections/${sec.id}`, { ...sec, name: e.target.value }))} />
            <select className="input" style={{ width: 'auto' }} value={sec.family} onChange={(e) => run(() => put(`/org/sections/${sec.id}`, { ...sec, family: e.target.value }))}><option value="viento">Viento</option><option value="percusion">Percusión</option><option value="otro">Otro</option></select>
            <span className="grow" />
            <button className="btn sm ghost" onClick={() => confirm(`¿Eliminar la sección ${sec.name}?`) && run(() => del(`/org/sections/${sec.id}`))}><Trash2 size={14} /></button>
          </div>
          {sec.instruments.map((i: any) => (
            <div key={i.id} className="card flat tight stack sm" style={{ marginLeft: 16 }}>
              <div className="row">
                <input className="input" style={{ maxWidth: 200 }} defaultValue={i.name} onBlur={(e) => e.target.value !== i.name && run(() => put(`/org/instruments/${i.id}`, { ...i, name: e.target.value }))} />
                <select className="input" style={{ width: 'auto' }} value={i.clef} onChange={(e) => run(() => put(`/org/instruments/${i.id}`, { ...i, clef: e.target.value }))}><option value="treble">Clave de sol</option><option value="bass">Clave de fa</option><option value="percussion">Percusión</option></select>
                <label className="small row nowrap">Transposición <input className="input" type="number" style={{ width: 70 }} defaultValue={i.transposition} onBlur={(e) => Number(e.target.value) !== i.transposition && run(() => put(`/org/instruments/${i.id}`, { ...i, transposition: Number(e.target.value) }))} /></label>
                <span className="grow" />
                <button className="btn sm ghost" onClick={() => confirm(`¿Eliminar ${i.name}?`) && run(() => del(`/org/instruments/${i.id}`))}><Trash2 size={14} /></button>
              </div>
              <div className="chips">
                {i.voices.map((v: any) => <span key={v.id} className="chip">{v.name} <Trash2 size={11} style={{ cursor: 'pointer' }} onClick={() => confirm(`¿Eliminar la voz ${v.name}?`) && run(() => del(`/org/voices/${v.id}`))} /></span>)}
                <button className="chip" onClick={() => { const n = prompt('Nombre de la voz (p. ej. «4ª voz», «Bajos»):'); if (n) run(() => post('/org/voices', { instrument_id: i.id, name: n, sort: i.voices.length })); }}><Plus size={12} /> Voz</button>
              </div>
            </div>
          ))}
          <button className="btn sm" style={{ alignSelf: 'flex-start', marginLeft: 16 }} onClick={() => { const n = prompt('Nombre del instrumento:'); if (n) run(() => post('/org/instruments', { section_id: sec.id, name: n, clef: sec.family === 'percusion' ? 'percussion' : 'treble', transposition: 0, sort: sec.instruments.length })); }}><Plus size={14} /> Instrumento</button>
        </div>
      ))}
      <div className="card row"><input className="input" style={{ maxWidth: 260 }} placeholder="Nueva sección" value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} /><select className="input" style={{ width: 'auto' }} value={ns.family} onChange={(e) => setNs({ ...ns, family: e.target.value })}><option value="viento">Viento</option><option value="percusion">Percusión</option><option value="otro">Otro</option></select><button className="btn primary" disabled={!ns.name} onClick={() => run(async () => { await post('/org/sections', { ...ns, color: '#c9a227', sort: s.data!.length }); setNs({ name: '', family: 'viento' }); })}><Plus size={16} /> Añadir sección</button></div>
    </div>
  );
}

function Leaders() {
  const toast = useToast();
  const { catalog, me } = useAuth();
  const l = useLoad(() => get<any[]>('/org/leaders'), []);
  const members = useLoad(() => get<any[]>('/members'), []);
  const struct = useLoad(() => get<any[]>('/org/structure'), []);
  const [f, setF] = useState({ user_id: '', section_id: '', permissions: ['attendance', 'members', 'announce', 'annotate', 'doubts'] });
  if (me?.role !== 'director') return <Notice kind="warn">Solo la dirección designa responsables.</Notice>;
  const savePerms = async (row: any, perms: string[]) => { await put('/org/leaders', { user_id: row.user_id, section_id: row.section_id, permissions: perms }); l.reload(); };
  return (
    <div className="stack">
      {(l.data ?? []).map((r) => (
        <div key={`${r.user_id}-${r.section_id}`} className="card stack sm">
          <div className="row between"><strong>{r.name} · {r.section}</strong><button className="btn sm ghost" onClick={async () => { await del(`/org/leaders/${r.user_id}/${r.section_id}`); l.reload(); }}><Trash2 size={14} /> Quitar</button></div>
          <div className="chips">{Object.entries(catalog.section).map(([k, v]) => <button key={k} className={`chip ${r.permissions.includes(k) ? 'on' : ''}`} onClick={() => savePerms(r, r.permissions.includes(k) ? r.permissions.filter((p: string) => p !== k) : [...r.permissions, k])}>{v}</button>)}</div>
        </div>
      ))}
      <div className="card stack">
        <h3>Designar responsable</h3>
        <div className="form-grid">
          <Field label="Componente"><select className="input" value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })}><option value="">—</option>{(members.data ?? []).filter((m) => m.role !== 'director').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
          <Field label="Sección"><select className="input" value={f.section_id} onChange={(e) => setF({ ...f, section_id: e.target.value })}><option value="">—</option>{(struct.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        </div>
        <div className="chips">{Object.entries(catalog.section).map(([k, v]) => <button key={k} className={`chip ${f.permissions.includes(k) ? 'on' : ''}`} onClick={() => setF({ ...f, permissions: f.permissions.includes(k) ? f.permissions.filter((p) => p !== k) : [...f.permissions, k] })}>{v}</button>)}</div>
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={!f.user_id || !f.section_id} onClick={async () => { try { await put('/org/leaders', { ...f, section_id: Number(f.section_id) }); l.reload(); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } }}><Save size={16} /> Guardar</button>
      </div>
    </div>
  );
}

function Branding() {
  const { branding, me } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ appName: branding.appName ?? 'ESTRELLA', bandName: branding.bandName ?? '', accent: branding.accent ?? '#c9a227', instagram: branding.instagram ?? '' });
  if (me?.role !== 'director') return <Notice kind="warn">Solo la dirección cambia la identidad.</Notice>;
  return (
    <div className="card stack" style={{ maxWidth: 640 }}>
      <Notice kind="info" title="Logotipo oficial">La app no incluye ningún escudo ni logotipo inventado. Sube aquí el logotipo oficial de la banda (PNG/JPG/WebP) si tenéis autorización para usarlo.</Notice>
      <Field label="Nombre del sistema"><input className="input" value={f.appName} onChange={(e) => setF({ ...f, appName: e.target.value })} /></Field>
      <Field label="Nombre de la banda"><input className="input" value={f.bandName} onChange={(e) => setF({ ...f, bandName: e.target.value })} /></Field>
      <Field label="Color de acento"><input type="color" value={f.accent} onChange={(e) => setF({ ...f, accent: e.target.value })} /></Field>
      <Field label="Instagram oficial"><input className="input" value={f.instagram} onChange={(e) => setF({ ...f, instagram: e.target.value })} /></Field>
      <div className="row">
        <button className="btn primary" onClick={async () => { try { await put('/org/branding', f); toast({ kind: 'ok', text: 'Identidad guardada' }); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } }}><Save size={16} /> Guardar</button>
        <label className="btn"><Upload size={16} /> Subir logotipo<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const fd = new FormData(); fd.append('file', file); try { await upload('/org/branding/logo', fd); toast({ kind: 'ok', text: 'Logotipo actualizado' }); } catch (x) { toast({ kind: 'error', text: (x as Error).message }); } }} /></label>
      </div>
    </div>
  );
}

function Invitations() {
  const l = useLoad(() => get<any[]>('/members/invitations/list'), []);
  return (
    <div className="card">
      <div className="table-wrap"><table className="table"><thead><tr><th>Correo</th><th>Rol</th><th>Creada</th><th>Caduca</th><th>Estado</th><th /></tr></thead>
        <tbody>{(l.data ?? []).map((i) => <tr key={i.code}><td>{i.email ?? '—'}</td><td>{i.role}</td><td className="small">{fmtDateTime(i.created_at)}</td><td className="small">{fmtDateTime(i.expires_at)}</td><td>{i.used_at ? <span className="badge ok">Usada por {i.used_by_name}</span> : new Date(i.expires_at) < new Date() ? <span className="badge">Caducada</span> : <span className="badge warn">Pendiente</span>}</td>
          <td>{!i.used_at && <button className="btn sm ghost" onClick={async () => { await del(`/members/invitations/${i.code}`); l.reload(); }}><Trash2 size={14} /></button>}</td></tr>)}</tbody></table></div>
    </div>
  );
}
