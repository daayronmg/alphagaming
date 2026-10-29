import { useState } from 'react';
import { Megaphone, Plus, Siren, FileText, Upload, Trash2, Eye, Check } from '../components/icons';
import { get, post, del, upload, fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Modal, Field, useToast, Tabs, Empty, Notice } from '../components/ui';
import { useRealtime } from '../lib/realtime';
import { fmtDateTime, fmtRelative } from '../lib/format';

export default function Announcements() {
  const { can, canSection, me } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'avisos' | 'documentos'>('avisos');
  const list = useLoad(() => get<any[]>('/comms/announcements'), []);
  const docs = useLoad(() => get<any[]>('/comms/documents'), []);
  const struct = useLoad(() => get<any[]>('/org/structure'), []);
  const [creating, setCreating] = useState(false);
  const [reads, setReads] = useState<string | null>(null);
  const [docUp, setDocUp] = useState(false);
  useRealtime((m) => { if (m.t === 'announcement') list.reload(); }, []);
  const canPost = can('announce.all') || canSection('announce');
  const markRead = async (id: string) => { await post(`/comms/announcements/${id}/read`); list.reload(); };
  const secName = (ids: number[]) => ids.map((i) => struct.data?.find((s) => s.id === i)?.name).filter(Boolean).join(', ');

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Comunicación interna</div><h1>Avisos</h1></div>
        <div className="row">
          <Tabs value={tab} onChange={setTab} items={[{ value: 'avisos', label: 'Avisos' }, { value: 'documentos', label: 'Documentos' }]} />
          {tab === 'avisos' && canPost && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={18} /> Nuevo aviso</button>}
          {tab === 'documentos' && (can('announce.all') || can('library.manage')) && <button className="btn primary" onClick={() => setDocUp(true)}><Upload size={18} /> Subir documento</button>}
        </div>
      </div>
      {tab === 'avisos' && (
        <div className="stack">
          {list.data && !list.data.length && <Empty icon={<Megaphone size={36} />} title="Sin avisos" />}
          {(list.data ?? []).map((a) => (
            <div key={a.id} className="card stack sm" style={a.urgent ? { borderColor: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 8%, var(--surface))' } : undefined}>
              <div className="row between">
                <div className="row">{a.urgent ? <Siren size={20} color="var(--danger)" /> : <Megaphone size={18} />}<h3>{a.title}</h3>
                  {a.urgent && <span className="badge danger">Urgente</span>}{a.category === 'cambio' && <span className="badge warn">Cambio de última hora</span>}{a.section_ids.length > 0 && <span className="badge">{secName(a.section_ids)}</span>}</div>
                <span className="xs faint">{a.author_name} · {fmtRelative(a.created_at)}</span>
              </div>
              <p className="pre">{a.body}</p>
              <div className="row">
                {a.read ? <span className="badge ok"><Check size={12} /> Leído</span> : <button className="btn sm" onClick={() => markRead(a.id)}><Check size={14} /> Confirmar lectura</button>}
                {(a.author_id === me?.id || me?.role === 'director') && <><button className="btn sm ghost" onClick={() => setReads(a.id)}><Eye size={14} /> {a.read_count} lecturas</button><button className="btn sm ghost" onClick={async () => { if (confirm('¿Eliminar el aviso?')) { await del(`/comms/announcements/${a.id}`); list.reload(); } }}><Trash2 size={14} /></button></>}
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === 'documentos' && (
        <div className="grid cols-3">
          {docs.data && !docs.data.length && <Empty icon={<FileText size={36} />} title="Sin documentos internos" />}
          {(docs.data ?? []).map((d) => (
            <a key={d.id} href={fileUrl(d.file_id)} target="_blank" rel="noreferrer" className="card hover stack sm">
              <FileText size={22} /><h3>{d.title}</h3>
              <div className="row" style={{ gap: 6 }}><span className="badge">{d.category}</span>{d.restricted && <span className="badge warn">Solo dirección y responsables</span>}</div>
              <span className="xs faint">{d.original_name} · {Math.round(d.size / 1024)} KB · {fmtDateTime(d.created_at)}</span>
            </a>
          ))}
        </div>
      )}
      {creating && <NewAnnouncement struct={struct.data ?? []} onClose={() => setCreating(false)} onDone={() => { setCreating(false); list.reload(); toast({ kind: 'ok', text: 'Aviso publicado' }); }} />}
      {reads && <ReadsModal id={reads} onClose={() => setReads(null)} />}
      {docUp && <DocUpload struct={struct.data ?? []} onClose={() => setDocUp(false)} onDone={() => { setDocUp(false); docs.reload(); }} />}
    </div>
  );
}

function NewAnnouncement({ struct, onClose, onDone }: { struct: any[]; onClose: () => void; onDone: () => void }) {
  const { can, me } = useAuth();
  const toast = useToast();
  const all = can('announce.all');
  const mine = me?.leaderOf.filter((l) => l.permissions.includes('announce')).map((l) => l.section_id) ?? [];
  const [f, setF] = useState({ title: '', body: '', urgent: false, section_ids: all ? [] as number[] : mine });
  return (
    <Modal title="Nuevo aviso" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className={`btn ${f.urgent ? 'danger' : 'primary'}`} disabled={!f.title || !f.body} onClick={async () => { try { await post('/comms/announcements', { ...f, category: f.urgent ? 'direccion' : f.section_ids.length ? 'seccion' : 'aviso' }); onDone(); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } }}>Publicar</button></>}>
      <div className="stack">
        <Field label="Título"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Mensaje"><textarea className="input" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <Field label="Destinatarios"><div className="chips">
          {all && <button className={`chip ${!f.section_ids.length ? 'on' : ''}`} onClick={() => setF({ ...f, section_ids: [] })}>Toda la banda</button>}
          {struct.filter((s) => all || mine.includes(s.id)).map((s) => <button key={s.id} className={`chip ${f.section_ids.includes(s.id) ? 'on' : ''}`} onClick={() => setF({ ...f, section_ids: f.section_ids.includes(s.id) ? f.section_ids.filter((x) => x !== s.id) : [...f.section_ids, s.id] })}>{s.name}</button>)}
        </div></Field>
        {all && <label className="checkbox"><input type="checkbox" checked={f.urgent} onChange={(e) => setF({ ...f, urgent: e.target.checked })} /> <strong>Aviso urgente</strong> (se destaca sobre todo lo demás y no se puede silenciar)</label>}
        {f.urgent && <Notice kind="warn">Úsalo solo para cambios importantes: los componentes lo recibirán aunque tengan silenciadas las notificaciones.</Notice>}
      </div>
    </Modal>
  );
}

function ReadsModal({ id, onClose }: { id: string; onClose: () => void }) {
  const r = useLoad(() => get<any[]>(`/comms/announcements/${id}/reads`), [id]);
  const read = (r.data ?? []).filter((x) => x.read_at);
  return (
    <Modal title={`Confirmaciones de lectura (${read.length}/${r.data?.length ?? 0})`} onClose={onClose}>
      <div className="stack sm">{(r.data ?? []).map((x) => <div key={x.id} className="row small"><span className="grow">{x.name}</span>{x.read_at ? <span className="badge ok">{fmtDateTime(x.read_at)}</span> : <span className="badge">Sin leer</span>}</div>)}</div>
    </Modal>
  );
}

function DocUpload({ struct, onClose, onDone }: { struct: any[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ title: '', category: 'general', restricted: false, section_ids: [] as number[] });
  return (
    <Modal title="Subir documento interno" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!file || !f.title} onClick={async () => {
      const fd = new FormData(); fd.append('file', file!); fd.append('title', f.title); fd.append('category', f.category); fd.append('restricted', f.restricted ? '1' : '0'); fd.append('section_ids', f.section_ids.join(','));
      try { await upload('/comms/documents', fd); onDone(); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); }
    }}>Subir</button></>}>
      <div className="stack">
        <Field label="Archivo (PDF, imagen, audio)"><input className="input" type="file" onChange={(e) => { const x = e.target.files?.[0] ?? null; setFile(x); if (x && !f.title) setF({ ...f, title: x.name.replace(/\.[^.]+$/, '') }); }} /></Field>
        <Field label="Título"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Categoría"><input className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        <Field label="Visible para"><div className="chips"><button className={`chip ${!f.section_ids.length ? 'on' : ''}`} onClick={() => setF({ ...f, section_ids: [] })}>Toda la banda</button>{struct.map((s) => <button key={s.id} className={`chip ${f.section_ids.includes(s.id) ? 'on' : ''}`} onClick={() => setF({ ...f, section_ids: f.section_ids.includes(s.id) ? f.section_ids.filter((x) => x !== s.id) : [...f.section_ids, s.id] })}>{s.name}</button>)}</div></Field>
        <label className="checkbox"><input type="checkbox" checked={f.restricted} onChange={(e) => setF({ ...f, restricted: e.target.checked })} /> Reservado a dirección y responsables</label>
      </div>
    </Modal>
  );
}
