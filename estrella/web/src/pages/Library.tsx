import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Plus, Star, Music, FileText, Headphones, FileMusic, Folder, Upload, Wand2 } from '../components/icons';
import GenerateNotes from '../components/GenerateNotes';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Empty, Modal, Field, useToast, Spinner, ErrorBox } from '../components/ui';

export default function Library() {
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [f, setF] = useState({ q: '', instrument: '', difficulty: '', composer: '', tag: '', folder: '', fav: '', event: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const list = useLoad(() => get<any[]>(`/library/marchas?${qs}`), [qs]);
  const meta = useLoad(() => get('/library/meta'), []);
  const struct = useLoad(() => get<any[]>('/org/structure'), []);
  const events = useLoad(() => get<any[]>('/events'), []);
  const [creating, setCreating] = useState(false);
  const [notes, setNotes] = useState(false);
  const instruments = (struct.data ?? []).flatMap((s) => s.instruments);

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Repertorio</div><h1>Biblioteca musical</h1></div>
        {can('library.manage') && <div className="row">{can('scores.publish') && <button className="btn" onClick={() => setNotes(true)}><Wand2 size={18} /> Sacar notas de los PDF</button>}<Link className="btn" to="/biblioteca/importar"><Upload size={18} /> Importar libreto</Link><button className="btn primary" onClick={() => setCreating(true)}><Plus size={18} /> Nueva marcha</button></div>}
      </div>
      <div className="card flat stack" style={{ marginBottom: 18 }}>
        <div className="row nowrap"><Search size={18} className="faint" /><input className="input" placeholder="Buscar por título o compositor…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Buscar" /></div>
        <div className="row">
          <select className="input" style={{ width: 'auto' }} value={f.instrument} onChange={(e) => setF({ ...f, instrument: e.target.value })}><option value="">Todos los instrumentos</option>{instruments.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          <select className="input" style={{ width: 'auto' }} value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value })}><option value="">Cualquier dificultad</option>{[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{'★'.repeat(d)}</option>)}</select>
          <select className="input" style={{ width: 'auto' }} value={f.event} onChange={(e) => setF({ ...f, event: e.target.value })}><option value="">Repertorio de…</option>{(events.data ?? []).filter((e) => e.repertoire_count > 0).map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select>
          <select className="input" style={{ width: 'auto' }} value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })}><option value="">Etiqueta</option>{(meta.data?.tags ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <select className="input" style={{ width: 'auto' }} value={f.folder} onChange={(e) => setF({ ...f, folder: e.target.value })}><option value="">Carpeta</option>{(meta.data?.folders ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <input className="input" style={{ width: 180 }} placeholder="Compositor" value={f.composer} onChange={(e) => setF({ ...f, composer: e.target.value })} />
          <button className={`chip ${f.fav ? 'on' : ''}`} onClick={() => setF({ ...f, fav: f.fav ? '' : '1' })}><Star size={14} /> Favoritas</button>
        </div>
      </div>
      {list.error && <ErrorBox error={list.error} retry={list.reload} />}
      {list.loading && !list.data && <Spinner />}
      {list.data && !list.data.length && <Empty icon={<Music size={36} />} title="No hay marchas con esos criterios">{can('library.manage') ? 'Crea la primera marcha y sube sus partituras.' : 'La dirección todavía no ha subido repertorio.'}</Empty>}
      <div className="grid cols-3">
        {(list.data ?? []).map((m) => (
          <Link key={m.id} to={can('library.manage') ? `/marchas/${m.id}` : `/tocar/${m.id}`} className="card hover stack sm">
            <div className="row between nowrap">
              <h3 className="ellipsis" style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 600 }}>{m.title}</h3>
              {m.favorite && <Star size={16} fill="var(--accent)" color="var(--accent)" />}
            </div>
            <div className="small muted ellipsis">{m.composer || 'Compositor no indicado'}{m.year ? ` · ${m.year}` : ''}</div>
            <div className="row" style={{ gap: 6 }}>
              {m.march_type && <span className="badge">{m.march_type}</span>}
              {m.difficulty && <span className="badge accent">{'★'.repeat(m.difficulty)}</span>}
              {m.is_demo && <span className="badge warn">Demostración</span>}
              {m.tags.filter((t: string) => t !== 'Demostración').map((t: string) => <span key={t} className="badge">{t}</span>)}
            </div>
            <div className="row small faint" style={{ gap: 14, marginTop: 4 }}>
              <span className="row" style={{ gap: 4 }}><FileText size={14} /> {m.parts} partituras</span>
              <span className="row" style={{ gap: 4 }}><FileMusic size={14} /> {m.scores} editables</span>
              <span className="row" style={{ gap: 4 }}><Headphones size={14} /> {m.recordings}</span>
            </div>
            {m.parts === 0 && m.scores === 0 && <span className="xs" style={{ color: 'var(--warn)' }}>Partituras todavía no disponibles</span>}
          </Link>
        ))}
      </div>
      {notes && <GenerateNotes onClose={() => { setNotes(false); list.reload(); }} />}
      {creating && <MarchaForm folders={meta.data?.folders ?? []} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); toast({ kind: 'ok', text: 'Marcha creada' }); nav(`/marchas/${id}`); }} />}
    </div>
  );
}

export function MarchaForm({ initial, folders, onClose, onSaved }: { initial?: any; folders: any[]; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [m, setM] = useState<any>(initial ?? { title: '', composer: '', year: '', duration_sec: '', march_type: '', instrumentation: '', measures: '', director_notes: '', difficulty: '', folder_id: '', last_reviewed_at: '', tags: '' });
  const [newFolder, setNewFolder] = useState('');
  const num = (v: any) => (v === '' || v == null ? null : Number(v));
  const save = async () => {
    try {
      let folder_id = num(m.folder_id);
      if (newFolder.trim()) folder_id = (await post('/library/folders', { name: newFolder.trim() })).id;
      const body = {
        title: m.title, composer: m.composer || null, year: num(m.year), duration_sec: m.duration_min ? Math.round(Number(m.duration_min) * 60) : num(m.duration_sec),
        march_type: m.march_type || null, instrumentation: m.instrumentation || null, measures: num(m.measures), director_notes: m.director_notes || null,
        difficulty: num(m.difficulty), folder_id, last_reviewed_at: m.last_reviewed_at || null,
        tags: String(m.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (initial?.id) { await (await import('../lib/api')).put(`/library/marchas/${initial.id}`, body); onSaved(initial.id); }
      else onSaved((await post('/library/marchas', body)).id);
    } catch (e) { toast({ kind: 'error', text: (e as Error).message }); }
  };
  const set = (k: string) => (e: any) => setM({ ...m, [k]: e.target.value });
  return (
    <Modal title={initial ? 'Editar ficha' : 'Nueva marcha'} wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!m.title} onClick={save}>Guardar</button></>}>
      <div className="form-grid">
        <Field label="Título *"><input className="input" value={m.title} onChange={set('title')} /></Field>
        <Field label="Compositor (si se conoce)"><input className="input" value={m.composer ?? ''} onChange={set('composer')} /></Field>
        <Field label="Año (si está documentado)"><input className="input" type="number" value={m.year ?? ''} onChange={set('year')} /></Field>
        <Field label="Duración (segundos)"><input className="input" type="number" value={m.duration_sec ?? ''} onChange={set('duration_sec')} /></Field>
        <Field label="Tipo de marcha"><input className="input" value={m.march_type ?? ''} onChange={set('march_type')} placeholder="Procesional, de concierto…" /></Field>
        <Field label="Número de compases"><input className="input" type="number" value={m.measures ?? ''} onChange={set('measures')} /></Field>
        <Field label="Dificultad"><select className="input" value={m.difficulty ?? ''} onChange={set('difficulty')}><option value="">—</option>{[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{'★'.repeat(d)}</option>)}</select></Field>
        <Field label="Última revisión"><input className="input" type="date" value={m.last_reviewed_at ?? ''} onChange={set('last_reviewed_at')} /></Field>
        <Field label="Carpeta"><select className="input" value={m.folder_id ?? ''} onChange={set('folder_id')}><option value="">Sin carpeta</option>{folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
        <Field label="…o nueva carpeta"><div className="row nowrap"><Folder size={16} /><input className="input" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} /></div></Field>
        <Field label="Etiquetas (separadas por comas)"><input className="input" value={m.tags ?? ''} onChange={set('tags')} /></Field>
        <Field label="Instrumentación"><input className="input" value={m.instrumentation ?? ''} onChange={set('instrumentation')} /></Field>
      </div>
      <div style={{ marginTop: 14 }}><Field label="Observaciones de la dirección"><textarea className="input" value={m.director_notes ?? ''} onChange={set('director_notes')} /></Field></div>
    </Modal>
  );
}
