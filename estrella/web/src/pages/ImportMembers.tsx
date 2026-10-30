import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, Download, CheckCircle2, AlertTriangle } from '../components/icons';
import { upload } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Notice, Field, useToast } from '../components/ui';

export default function ImportMembers() {
  const { can } = useAuth();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [create, setCreate] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [done, setDone] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  if (!can('members.manage')) return <div className="page"><Notice kind="danger">Sin permiso.</Notice></div>;
  const send = async (modo: 'previsualizar' | 'importar') => {
    if (!file) return;
    setBusy(true);
    const fd = new FormData(); fd.append('file', file); fd.append('modo', modo); fd.append('crear_estructura', create ? '1' : '0');
    try { const r = await upload('/members/import', fd); if (modo === 'importar') { setDone(r); setPreview(null); } else setPreview(r); }
    catch (e) { toast({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };
  return (
    <div className="page stack lg">
      <div className="page-head"><div><div className="eyebrow"><Link to="/componentes">Componentes</Link></div><h1>Importar componentes</h1></div><a className="btn" href="/api/members/import/template"><Download size={16} /> Plantilla CSV</a></div>
      <Notice kind="info" title="Formato">CSV (separado por «;» o «,») o Excel (.xlsx). Columnas: <strong>nombre</strong>, apellidos, <strong>correo</strong>, sección, instrumento, voz, rol (componente/responsable), permisos, estado. Primero se muestra una vista previa; no se cambia nada hasta confirmar. El rol de dirección nunca se concede por importación.</Notice>
      <div className="card stack">
        <Field label="Archivo"><input className="input" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setDone(null); }} /></Field>
        <label className="checkbox"><input type="checkbox" checked={create} onChange={(e) => setCreate(e.target.checked)} /> Crear secciones, instrumentos y voces que no existan</label>
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={!file || busy} onClick={() => send('previsualizar')}><Upload size={16} /> Previsualizar</button>
      </div>
      {preview && (
        <div className="card stack">
          <div className="row"><span className="badge ok">{preview.summary.crear} nuevos</span><span className="badge info">{preview.summary.actualizar} a actualizar</span><span className={`badge ${preview.summary.errores ? 'danger' : ''}`}>{preview.summary.errores} con errores</span></div>
          <div className="table-wrap"><table className="table"><thead><tr><th>Fila</th><th>Nombre</th><th>Correo</th><th>Asignación</th><th>Rol</th><th>Acción</th><th>Avisos</th></tr></thead>
            <tbody>{preview.rows.map((r: any) => (
              <tr key={r.line}><td>{r.line}</td><td>{r.name}</td><td className="small">{r.email}</td><td className="small">{[r.section, r.instrument, r.voice].filter(Boolean).join(' · ') || '—'}{r.create && <span className="badge warn" style={{ marginLeft: 4 }}>se creará</span>}</td><td>{r.role === 'leader' ? 'Responsable' : 'Componente'}</td>
                <td>{r.action === 'error' ? <span className="badge danger">Error</span> : r.action === 'crear' ? <span className="badge ok">Crear</span> : <span className="badge info">Actualizar</span>}</td>
                <td className="xs">{[...r.errors.map((e: string) => `✘ ${e}`), ...r.warnings.map((w: string) => `⚠ ${w}`)].join(' · ')}</td></tr>
            ))}</tbody></table></div>
          {preview.summary.actualizar > 0 && <p className="xs muted">Los cambios de instrumento o voz de componentes existentes quedan pendientes de confirmar en su ficha.</p>}
          <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy || preview.summary.errores > 0} onClick={() => send('importar')}>Confirmar importación</button>
        </div>
      )}
      {done && (
        <div className="card stack">
          <Notice kind="ok" title="Importación completada">{done.summary.crear} creados · {done.summary.actualizar} actualizados. Cada persona activa su cuenta con su propio enlace:</Notice>
          <div className="table-wrap"><table className="table"><tbody>{done.invitations.map((i: any) => <tr key={i.email}><td>{i.name}</td><td className="small">{i.email}</td><td><input className="input mono xs" readOnly value={i.link} onFocus={(e) => e.target.select()} /></td></tr>)}</tbody></table></div>
          <p className="xs faint"><AlertTriangle size={12} /> Envía cada enlace solo a su destinatario. <CheckCircle2 size={12} /> Caducan en 30 días.</p>
        </div>
      )}
    </div>
  );
}
