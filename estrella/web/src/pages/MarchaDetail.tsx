import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  Star, FileText, Headphones, FileMusic, Upload, RefreshCw, History, Pencil, AlertTriangle, CheckCircle2, Users, Plus, Eye, Music, ChevronRight, Trash2,
} from '../components/icons';
import { get, put, del, upload, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Spinner, ErrorBox, Notice, Tabs, Modal, Field, useToast, Empty } from '../components/ui';
import { useRealtime, useChannel } from '../lib/realtime';
import { fmtDate, fmtDateTime } from '../lib/format';
import AudioPlayer from '../components/AudioPlayer';
import { MarchaForm } from './Library';
import { loadPages } from '../lib/pdf';
import { parseMusicXML } from '../lib/musicxml';
import { emptyScore } from '../../../shared/music';

export default function MarchaDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const m = useLoad(() => get(`/library/marchas/${id}`), [id]);
  const meta = useLoad(() => get('/library/meta'), []);
  const [tab, setTab] = useState<'partituras' | 'editables' | 'audio' | 'historial'>('partituras');
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState<null | { replaces?: any }>(null);
  const [newScore, setNewScore] = useState(false);
  const [coverage, setCoverage] = useState(false);
  const [recUpload, setRecUpload] = useState(false);
  useChannel(id ? `marcha:${id}` : null);
  useRealtime((x) => { if (['marcha:changed', 'parts:changed', 'score:published'].includes(x.t) && x.marchaId === id) m.reload(); }, [id]);

  if (m.error) return <div className="page"><ErrorBox error={m.error} retry={m.reload} /></div>;
  if (!m.data) return <Spinner />;
  const x = m.data;
  const mine = x.mine;
  const manage = can('library.manage');
  const fav = async () => { await put(`/library/marchas/${id}/favorite`, { favorite: !x.favorite }); m.reload(); };
  const assignLabel = mine.assignment ? `${mine.assignment.instrument}${mine.assignment.voice ? ` · ${mine.assignment.voice}` : ''}` : '';

  return (
    <div className="page stack lg">
      <div className="hero">
        <div className="row between">
          <div className="stack sm">
            <div className="row" style={{ gap: 6 }}>{x.march_type && <span className="badge">{x.march_type}</span>}{x.difficulty && <span className="badge accent">{'★'.repeat(x.difficulty)}</span>}{x.is_demo && <span className="badge warn">Datos de demostración</span>}{x.tags.map((t: any) => <span key={t.id} className="badge">{t.name}</span>)}</div>
            <h1>{x.title}</h1>
            <div className="muted">{x.composer || 'Compositor no indicado'}{x.year ? ` · ${x.year}` : ''}{x.duration_sec ? ` · ${Math.floor(x.duration_sec / 60)}:${String(x.duration_sec % 60).padStart(2, '0')}` : ''}{x.measures ? ` · ${x.measures} compases` : ''}</div>
          </div>
          <div className="row">
            <button className={`btn icon ${x.favorite ? 'on' : ''}`} onClick={fav} aria-label="Favorita"><Star size={18} fill={x.favorite ? 'currentColor' : 'none'} /></button>
            {manage && <button className="btn" onClick={() => setEditing(true)}><Pencil size={16} /> Editar ficha</button>}
          </div>
        </div>
        {x.director_notes && <div className="notice" style={{ marginTop: 16 }}><Music size={18} /><div><strong className="small">Observaciones de la dirección</strong><p className="small pre">{x.director_notes}</p></div></div>}
      </div>

      {/* Parte personal */}
      <div className="card" style={{ borderColor: mine.status === 'ok' ? 'color-mix(in srgb, var(--ok) 50%, transparent)' : 'color-mix(in srgb, var(--warn) 50%, transparent)' }} data-testid="my-part">
        <div className="row between">
          <div className="row nowrap">
            {mine.status === 'ok' ? <CheckCircle2 color="var(--ok)" /> : <AlertTriangle color="var(--warn)" />}
            <div><h3>{mine.status === 'ok' ? 'Tu parte' : 'Tu parte no está disponible'}</h3><div className="small muted">{mine.message}</div></div>
          </div>
          <div className="row">
            {mine.part && <Link className="btn primary" to={`/partitura/${mine.part.id}`} data-testid="open-my-part"><FileText size={17} /> Abrir partitura ({mine.part.label})</Link>}
            {mine.score && <Link className="btn" to={`/score/${mine.score.id}`}><FileMusic size={17} /> Versión editable v{mine.score.version_number}</Link>}
          </div>
        </div>
        {mine.status !== 'ok' && mine.available.length > 0 && <p className="small muted" style={{ marginTop: 10 }}>Partes disponibles: {mine.available.map((a: any) => a.label).join(', ')}. No se muestra otra voz como si fuera la tuya.</p>}
        {mine.assignments.length > 1 && <p className="xs faint" style={{ marginTop: 8 }}>Tienes varias asignaciones; se abre la principal ({assignLabel}). La dirección puede elegir otra para un ensayo concreto.</p>}
        {mine.reference && <p className="small" style={{ marginTop: 8 }}><Link to={`/partitura/${mine.reference.id}`} className="muted"><Eye size={14} style={{ verticalAlign: -2 }} /> Partitura general de referencia (no es tu parte)</Link></p>}
      </div>

      <div className="row between">
        <Tabs value={tab} onChange={setTab} items={[
          { value: 'partituras', label: `Partituras (${x.parts.length})` }, { value: 'editables', label: `Editables (${x.scores.length})` },
          { value: 'audio', label: `Grabaciones (${x.recordings.length})` }, { value: 'historial', label: 'Historial' },
        ]} />
        {manage && tab === 'partituras' && <div className="row"><button className="btn" onClick={() => setCoverage(true)}><Users size={16} /> ¿Qué recibe cada componente?</button><button className="btn primary" onClick={() => setUploading({})}><Upload size={16} /> Subir partitura</button></div>}
        {manage && tab === 'editables' && can('scores.publish') && <button className="btn primary" onClick={() => setNewScore(true)}><Plus size={16} /> Nueva partitura editable</button>}
        {manage && tab === 'audio' && <button className="btn primary" onClick={() => setRecUpload(true)}><Upload size={16} /> Subir audio</button>}
      </div>

      {tab === 'partituras' && (
        <div className="card flat">
          {!x.parts.length && <Empty icon={<FileText size={34} />} title="Todavía no hay partituras">Cuando la dirección suba los archivos aparecerán aquí, identificados por instrumento y voz.</Empty>}
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Partitura</th><th>Instrumento</th><th>Voz</th><th>Versión</th><th>Compases vinculados</th><th /></tr></thead>
            <tbody>{x.parts.map((p: any) => (
              <tr key={p.id}>
                <td><Link to={`/partitura/${p.id}`} style={{ fontWeight: 650 }}>{p.label}</Link>{!p.instrument_id && <span className="badge" style={{ marginLeft: 6 }}>Referencia general</span>}</td>
                <td>{p.instrument ?? '—'}</td><td>{p.voice ?? (p.instrument ? 'Común' : '—')}</td>
                <td>v{p.version} <span className="xs faint">{fmtDate(p.created_at)}</span></td>
                <td>{p.mapped_measures ? <span className="badge ok">{p.mapped_measures}</span> : <span className="badge warn">sin vincular</span>}</td>
                <td className="row" style={{ justifyContent: 'flex-end' }}>
                  <Link className="btn sm" to={`/partitura/${p.id}`}>Abrir</Link>
                  {manage && <button className="btn sm" onClick={() => setUploading({ replaces: p })}><RefreshCw size={14} /> Sustituir</button>}
                  {manage && <button className="btn sm icon ghost" aria-label="Retirar" onClick={async () => { if (confirm(`¿Retirar la partitura «${p.label}»? Se conserva en el historial.`)) { await del(`/library/parts/${p.id}`); m.reload(); } }}><Trash2 size={14} /></button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
          {x.old_parts.length > 0 && <details style={{ marginTop: 12 }}><summary className="small muted">Versiones anteriores ({x.old_parts.length})</summary>
            <div className="stack sm" style={{ marginTop: 8 }}>{x.old_parts.map((p: any) => <Link key={p.id} to={`/partitura/${p.id}`} className="small muted">{p.label} · v{p.version} · {fmtDate(p.created_at)}</Link>)}</div></details>}
        </div>
      )}

      {tab === 'editables' && (
        <div className="stack">
          <Notice kind="info" title="Partitura musical editable (modo B)">Permite corregir notas, ritmo y articulaciones, y publicar versiones. Se crea desde MusicXML (exportado de MuseScore, Sibelius, Finale…), transcribiendo la parte o, si el servidor lo tiene configurado, con reconocimiento óptico revisado manualmente.</Notice>
          {!x.scores.length && <Empty icon={<FileMusic size={34} />} title="Sin versiones editables" />}
          <div className="grid cols-3">{x.scores.map((s: any) => (
            <Link key={s.id} to={`/score/${s.id}`} className="card hover stack sm">
              <h3>{s.label}</h3>
              <div className="small muted">{s.instrument ?? 'General'}{s.voice ? ` · ${s.voice}` : ''}</div>
              <div className="row" style={{ gap: 6 }}>
                {s.published_version_id ? <span className="badge ok">Publicada v{s.version_number}</span> : <span className="badge warn">Borrador sin publicar</span>}
                {s.needs_review && <span className="badge danger">Requiere revisión</span>}
                <span className="badge">{s.source === 'musicxml' ? 'MusicXML' : s.source === 'omr' ? 'OMR' : 'Manual'}</span>
              </div>
            </Link>
          ))}</div>
        </div>
      )}

      {tab === 'audio' && (
        <div className="card">
          <AudioPlayer tracks={x.recordings} storageKey={x.id} />
          {manage && x.recordings.length > 0 && <div className="stack sm" style={{ marginTop: 14 }}>{x.recordings.map((r: any) => <div key={r.id} className="row small"><span className="grow">{r.label} · {r.kind}{r.instrument ? ` · ${r.instrument}` : ''}</span><button className="btn sm ghost" onClick={async () => { if (confirm('¿Eliminar grabación?')) { await del(`/library/recordings/${r.id}`); m.reload(); } }}><Trash2 size={14} /></button></div>)}</div>}
        </div>
      )}

      {tab === 'historial' && (
        <div className="grid cols-2">
          <div className="card"><div className="card-title"><h3><History size={18} /> Control de cambios</h3></div>
            <div className="stack sm">{x.changes.map((c: any) => <div key={c.id} className="small"><span className="faint">{fmtDateTime(c.at)} · {c.user_name ?? 'Sistema'}</span><div>{c.summary}</div></div>)}</div>
          </div>
          <div className="card"><div className="card-title"><h3>Historial de ensayos</h3></div>
            {!x.history.length && <p className="small muted">Aún no se ha trabajado en ningún ensayo registrado.</p>}
            <div className="stack sm">{x.history.map((e: any) => (
              <Link key={e.id} to={`/eventos/${e.id}`} className="list-item" style={{ padding: 8 }}>
                <div className="grow"><div className="small" style={{ fontWeight: 650 }}>{e.title}</div><div className="xs muted">{fmtDate(e.starts_at)}{e.passages.length ? ` · pasajes: ${e.passages.map((p: any) => `c.${p.from}–${p.to}`).join(', ')}` : ''}</div></div><ChevronRight size={16} />
              </Link>
            ))}</div>
          </div>
        </div>
      )}

      {editing && <MarchaForm initial={{ ...x, tags: x.tags.map((t: any) => t.name).join(', ') }} folders={meta.data?.folders ?? []} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); m.reload(); toast({ kind: 'ok', text: 'Ficha actualizada' }); }} />}
      {uploading && <PartUpload marchaId={x.id} replaces={uploading.replaces} onClose={() => setUploading(null)} onDone={() => { setUploading(null); m.reload(); }} />}
      {coverage && <Coverage marchaId={x.id} onClose={() => setCoverage(false)} />}
      {recUpload && <RecordingUpload marchaId={x.id} onClose={() => setRecUpload(false)} onDone={() => { setRecUpload(false); m.reload(); }} />}
      {newScore && <NewScore marcha={x} onClose={() => setNewScore(false)} onCreated={(sid) => nav(`/score/${sid}`)} />}
    </div>
  );
}

export function InstrumentVoicePicker({ value, onChange, allowGeneral }: { value: { instrument_id: number | null; voice_id: number | null }; onChange: (v: { instrument_id: number | null; voice_id: number | null }) => void; allowGeneral?: boolean }) {
  const struct = useLoad(() => get<any[]>('/org/structure'), []);
  const instruments = (struct.data ?? []).flatMap((s) => s.instruments.map((i: any) => ({ ...i, section: s.name })));
  const inst = instruments.find((i) => i.id === value.instrument_id);
  return (
    <div className="form-grid">
      <Field label="Instrumento"><select className="input" value={value.instrument_id ?? ''} onChange={(e) => onChange({ instrument_id: e.target.value ? Number(e.target.value) : null, voice_id: null })}>
        {allowGeneral && <option value="">General / referencia (sin instrumento)</option>}
        {!allowGeneral && <option value="">Elige…</option>}
        {instruments.map((i) => <option key={i.id} value={i.id}>{i.section} · {i.name}</option>)}
      </select></Field>
      <Field label="Voz"><select className="input" value={value.voice_id ?? ''} onChange={(e) => onChange({ ...value, voice_id: e.target.value ? Number(e.target.value) : null })} disabled={!inst}>
        <option value="">{inst?.voices.length ? 'Común a todas las voces' : 'Sin voces'}</option>
        {(inst?.voices ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select></Field>
    </div>
  );
}

function PartUpload({ marchaId, replaces, onClose, onDone }: { marchaId: string; replaces?: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState(replaces?.label ?? '');
  const [arr, setArr] = useState(replaces?.arrangement ?? '');
  const [iv, setIv] = useState<{ instrument_id: number | null; voice_id: number | null }>({ instrument_id: replaces?.instrument_id ?? null, voice_id: replaces?.voice_id ?? null });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      let pages: number | undefined;
      if (file.type === 'application/pdf') {
        const url = URL.createObjectURL(file);
        try { pages = (await loadPages(url, 'pdf')).length; } catch { throw new Error('El PDF no se puede leer. Comprueba que no está dañado ni protegido.'); } finally { URL.revokeObjectURL(url); }
      }
      const fd = new FormData();
      fd.append('file', file);
      fd.append('label', label);
      if (iv.instrument_id) fd.append('instrument_id', String(iv.instrument_id));
      if (iv.voice_id) fd.append('voice_id', String(iv.voice_id));
      if (arr) fd.append('arrangement', arr);
      if (pages) fd.append('page_count', String(pages));
      if (replaces) fd.append('replaces_part_id', replaces.id);
      await upload(`/library/marchas/${marchaId}/parts`, fd);
      toast({ kind: 'ok', text: replaces ? 'Nueva versión publicada. Los músicos verán el aviso.' : 'Partitura añadida' });
      onDone();
    } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };
  return (
    <Modal title={replaces ? `Sustituir «${replaces.label}»` : 'Subir partitura'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!file || !label || busy || (!iv.instrument_id && !replaces && false)} onClick={submit}>{busy ? 'Subiendo…' : 'Subir'}</button></>}>
      <div className="stack">
        <Field label="Archivo (PDF o imagen)"><input className="input" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !label) setLabel(f.name.replace(/\.[^.]+$/, '')); }} /></Field>
        <Field label="Nombre visible"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Corneta 3ª voz" /></Field>
        {!replaces && <InstrumentVoicePicker value={iv} onChange={setIv} allowGeneral />}
        {replaces && <Notice kind="info">Se crea la versión {replaces.version + 1}. La anterior queda en el historial y se avisa a quien la tenga abierta. El mapa de compases se copia: revísalo si cambia la maquetación.</Notice>}
        <Field label="Arreglo / versión (opcional)"><input className="input" value={arr} onChange={(e) => setArr(e.target.value)} /></Field>
        <p className="xs muted">El archivo se valida por su contenido y se guarda de forma privada. Solo los miembros autenticados pueden abrirlo.</p>
      </div>
    </Modal>
  );
}

function RecordingUpload({ marchaId, onClose, onDone }: { marchaId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState('banda');
  const [iv, setIv] = useState<{ instrument_id: number | null; voice_id: number | null }>({ instrument_id: null, voice_id: null });
  return (
    <Modal title="Subir grabación" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!file || !label} onClick={async () => {
      const fd = new FormData(); fd.append('file', file!); fd.append('label', label); fd.append('kind', kind);
      if (iv.instrument_id) fd.append('instrument_id', String(iv.instrument_id)); if (iv.voice_id) fd.append('voice_id', String(iv.voice_id));
      try { await upload(`/library/marchas/${marchaId}/recordings`, fd); onDone(); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); }
    }}>Subir</button></>}>
      <div className="stack">
        <Field label="Archivo de audio (MP3, WAV, OGG, M4A)"><input className="input" type="file" accept="audio/*" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !label) setLabel(f.name.replace(/\.[^.]+$/, '')); }} /></Field>
        <Field label="Nombre"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        <Field label="Tipo"><select className="input" value={kind} onChange={(e) => setKind(e.target.value)}><option value="banda">Grabación de la banda</option><option value="pista">Pista separada (por voz)</option><option value="referencia">Referencia</option></select></Field>
        {kind === 'pista' && <InstrumentVoicePicker value={iv} onChange={setIv} />}
      </div>
    </Modal>
  );
}

function Coverage({ marchaId, onClose }: { marchaId: string; onClose: () => void }) {
  const c = useLoad(() => get<any[]>(`/library/marchas/${marchaId}/coverage`), [marchaId]);
  return (
    <Modal title="Parte que recibe cada componente" wide onClose={onClose}>
      {!c.data ? <Spinner /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Componente</th><th>Asignación</th><th>Partitura</th><th>Estado</th></tr></thead>
          <tbody>{c.data.map((r) => <tr key={r.user_id}><td>{r.name}</td><td>{r.assignment ?? '—'}</td><td>{r.part ?? r.score ?? '—'}</td><td>{r.status === 'ok' ? <span className="badge ok">Correcta</span> : r.status === 'falta_parte' ? <span className="badge danger">Falta su parte</span> : <span className="badge warn">Sin asignación</span>}</td></tr>)}</tbody>
        </table></div>
      )}
    </Modal>
  );
}

function NewScore({ marcha, onClose, onCreated }: { marcha: any; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'musicxml' | 'manual' | 'omr'>('musicxml');
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [iv, setIv] = useState<{ instrument_id: number | null; voice_id: number | null }>({ instrument_id: null, voice_id: null });
  const [partId, setPartId] = useState('');
  const [manual, setManual] = useState({ measures: 16, beats: 2, beatType: 4, key: 0, tempo: 80, clef: 'treble' });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      let content: any; let source = mode; let srcFile: Blob | null = null;
      if (mode === 'musicxml') {
        if (!file) throw new Error('Elige un archivo MusicXML (.musicxml o .xml sin comprimir).');
        const text = await file.text();
        const r = parseMusicXML(text, label || marcha.title);
        content = r.doc; setWarnings(r.warnings); srcFile = file;
      } else if (mode === 'omr') {
        if (!partId) throw new Error('Elige la partitura PDF a reconocer.');
        const r = await post(`/scores/omr/${partId}`);
        const xml = await (await fetch(`/api/scores/source/${r.file_id}`)).text();
        const parsed = parseMusicXML(xml, label || marcha.title);
        content = parsed.doc; source = 'musicxml';
        toast({ kind: 'info', text: r.warning });
      } else {
        content = emptyScore(label || marcha.title, { time: [manual.beats, manual.beatType], key: manual.key, tempo: manual.tempo, clef: manual.clef as any }, manual.measures);
      }
      const fd = new FormData();
      fd.append('payload', JSON.stringify({ marcha_id: marcha.id, label: label || 'Parte', instrument_id: iv.instrument_id, voice_id: iv.voice_id, part_id: partId || null, source: source === 'omr' ? 'musicxml' : source, content }));
      if (srcFile) fd.append('file', srcFile, file!.name);
      const s = await upload('/scores', fd);
      onCreated(s.id);
    } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };
  return (
    <Modal title="Nueva partitura editable" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !label} onClick={create}>{busy ? 'Procesando…' : 'Crear borrador'}</button></>}>
      <div className="stack">
        <Tabs value={mode} onChange={setMode} items={[{ value: 'musicxml', label: 'Importar MusicXML' }, { value: 'manual', label: 'Transcribir' }, { value: 'omr', label: 'Reconocer PDF (OMR)' }]} />
        <Field label="Nombre"><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Corneta 3ª voz" /></Field>
        <InstrumentVoicePicker value={iv} onChange={setIv} allowGeneral />
        <Field label="PDF original vinculado (para comparar)"><select className="input" value={partId} onChange={(e) => setPartId(e.target.value)}><option value="">Ninguno</option>{marcha.parts.map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
        {mode === 'musicxml' && <Field label="Archivo MusicXML" hint="Exporta desde MuseScore: Archivo → Exportar → MusicXML sin comprimir (.musicxml). Se importa la primera parte y la primera voz."><input className="input" type="file" accept=".musicxml,.xml,application/xml,text/xml" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>}
        {mode === 'manual' && (
          <div className="form-grid">
            <Field label="Compases"><input className="input" type="number" value={manual.measures} onChange={(e) => setManual({ ...manual, measures: Number(e.target.value) })} /></Field>
            <Field label="Compás"><div className="row nowrap"><input className="input" type="number" value={manual.beats} onChange={(e) => setManual({ ...manual, beats: Number(e.target.value) })} /> / <select className="input" value={manual.beatType} onChange={(e) => setManual({ ...manual, beatType: Number(e.target.value) })}><option>2</option><option>4</option><option>8</option></select></div></Field>
            <Field label="Armadura (quintas: + sostenidos, − bemoles)"><input className="input" type="number" min={-7} max={7} value={manual.key} onChange={(e) => setManual({ ...manual, key: Number(e.target.value) })} /></Field>
            <Field label="Tempo"><input className="input" type="number" value={manual.tempo} onChange={(e) => setManual({ ...manual, tempo: Number(e.target.value) })} /></Field>
            <Field label="Clave"><select className="input" value={manual.clef} onChange={(e) => setManual({ ...manual, clef: e.target.value })}><option value="treble">Sol</option><option value="bass">Fa</option><option value="percussion">Percusión</option></select></Field>
          </div>
        )}
        {mode === 'omr' && <Notice kind="warn" title="Reconocimiento automático">Requiere Audiveris instalado en el servidor. El resultado se crea como BORRADOR marcado «requiere revisión»: compáralo con el PDF original y corrige las notas antes de publicar. Los escaneos de baja calidad pueden no reconocerse.</Notice>}
        {warnings.length > 0 && <Notice kind="warn" title="Avisos de importación">{warnings.join(' · ')}</Notice>}
      </div>
    </Modal>
  );
}
