import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Play, Trash2, Plus, CheckCircle2 } from '../components/icons';
import GenerateNotes from '../components/GenerateNotes';
import { get, post, upload } from '../lib/api';
import { useAuth } from '../lib/auth';
import { readPdfText } from '../lib/pdf';
import { useLoad, Notice, Field, useToast } from '../components/ui';
import { detectInstrument, detectPage } from '../../../shared/book';

type Mode = 'pdf' | 'carpeta' | 'audio' | 'vacia';
const TITLES: Record<Mode, string> = { pdf: 'Un PDF con todas las secciones', carpeta: 'Una carpeta con todas las secciones', audio: 'Subir audio o vídeo', vacia: 'Nueva marcha' };
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const fromFileName = (n: string) => n.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

interface Opt { key: string; instrument_id: number; voice_id: number | null; label: string }
interface Section { key: string; from: number; to: number }
interface FilePart { file: File; key: string; pages: number }

/** Añadir una marcha: con un PDF de todas las secciones, con varios PDF, con audio o vacía. Termina sonando. */
export default function NewMarcha() {
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const mode = (useSearchParams()[0].get('modo') as Mode) || 'vacia';
  const struct = useLoad(() => get<any[]>('/org/structure'), []);
  const [title, setTitle] = useState('');
  const [composer, setComposer] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [sections, setSections] = useState<Section[]>([]);
  const [files, setFiles] = useState<FilePart[]>([]);
  const [audio, setAudio] = useState<File[]>([]);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState('');
  const [marchaId, setMarchaId] = useState<string | null>(null);
  const [notes, setNotes] = useState(false);
  const [finished, setFinished] = useState(false);

  // instrumento + voz en una sola lista: «Corneta 1ª voz», «Corneta (todas las voces)», «Caja»…
  const opts: Opt[] = useMemo(() => (struct.data ?? []).flatMap((s: any) => s.instruments.flatMap((i: any) => i.voices.length
    ? [...i.voices.map((v: any) => ({ key: `${i.id}:${v.id}`, instrument_id: i.id, voice_id: v.id, label: `${i.name} ${v.name}` })), { key: `${i.id}:`, instrument_id: i.id, voice_id: null, label: `${i.name} (todas las voces)` }]
    : [{ key: `${i.id}:`, instrument_id: i.id, voice_id: null, label: i.name }])), [struct.data]);
  const optOf = (key: string) => opts.find((o) => o.key === key);
  const match = (d: { instrument: string; voice: number | null } | null): string => {
    if (!d) return '';
    const inst = (struct.data ?? []).flatMap((s: any) => s.instruments).find((i: any) => norm(i.name) === norm(d.instrument));
    if (!inst) return '';
    const v = d.voice ? inst.voices.find((x: any) => norm(x.name).startsWith(String(d.voice))) : null;
    return `${inst.id}:${v?.id ?? ''}`;
  };

  if (!can('library.manage')) return <div className="page"><Notice kind="danger">Solo la dirección puede añadir marchas.</Notice></div>;

  const pickPdf = async (f: File | null) => {
    setFile(f); setSections([]); setPageCount(0);
    if (!f) return;
    setReading(true);
    try {
      const pages = await readPdfText(f);
      setPageCount(pages.length);
      if (!title) { const t = detectPage(pages[0]).title; setTitle(t || fromFileName(f.name)); const c = detectPage(pages[0]).composer; if (c && !composer) setComposer(c); }
      // cada página: ¿de qué instrumento y voz es? Las páginas sin rótulo siguen a la anterior
      const out: Section[] = [];
      pages.forEach((p, i) => {
        const k = match(detectInstrument([p]));
        const last = out[out.length - 1];
        if (last && (!k || k === last.key)) last.to = i + 1;
        else out.push({ key: k, from: i + 1, to: i + 1 });
      });
      setSections(out);
    } catch { toast({ kind: 'error', text: 'El PDF no se puede leer. Comprueba que no está dañado ni protegido.' }); setFile(null); }
    finally { setReading(false); }
  };

  const pickMany = async (list: FileList | null) => {
    const arr = [...(list ?? [])].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!arr.length) return;
    setReading(true);
    const out: FilePart[] = [...files];
    for (const f of arr) {
      try {
        const pages = await readPdfText(f);
        if (!title && !out.length) { const d = detectPage(pages[0]); setTitle(d.title || ''); if (d.composer) setComposer(d.composer); }
        out.push({ file: f, key: match(detectInstrument(pages, f.name)), pages: pages.length });
      } catch { toast({ kind: 'error', text: `No se puede leer «${f.name}».` }); }
    }
    setFiles(out); setReading(false);
  };

  const ready = !!title.trim() && (mode === 'vacia' || (mode === 'pdf' && file && sections.length && sections.every((s) => s.key))
    || (mode === 'carpeta' && files.length && files.every((f) => f.key)) || (mode === 'audio' && audio.length));

  const save = async () => {
    try {
      setBusy('Creando la marcha…');
      // si ya existe una marcha con ese título, se le añaden las partes
      const same = (await get<any[]>(`/library/marchas?q=${encodeURIComponent(title.trim())}`)).find((m) => !m.is_demo && !m.private && norm(m.title) === norm(title));
      const id: string = same?.id ?? (await post('/library/marchas', { title: title.trim(), composer: composer.trim() || null, tags: [] })).id;
      setMarchaId(id);
      if (mode === 'vacia') { nav(`/marchas/${id}`); return; }
      if (mode === 'pdf' && file) {
        setBusy('Subiendo el PDF…');
        const fd = new FormData();
        fd.append('file', file); fd.append('page_count', String(pageCount));
        fd.append('sections', JSON.stringify(sections.map((s) => { const o = optOf(s.key)!; return { instrument_id: o.instrument_id, voice_id: o.voice_id, label: o.label, from: s.from, to: s.to }; })));
        await upload(`/library/marchas/${id}/sections`, fd);
      }
      if (mode === 'carpeta') {
        const existing: any[] = same ? (await get<any>(`/library/marchas/${id}`)).parts ?? [] : [];
        for (const [n, fp] of files.entries()) {
          const o = optOf(fp.key)!;
          setBusy(`Subiendo ${n + 1} de ${files.length}: ${o.label}…`);
          const fd = new FormData();
          fd.append('file', fp.file); fd.append('label', o.label); fd.append('instrument_id', String(o.instrument_id)); fd.append('page_count', String(fp.pages));
          if (o.voice_id) fd.append('voice_id', String(o.voice_id));
          const old = existing.find((p) => p.instrument_id === o.instrument_id && (p.voice_id ?? null) === o.voice_id);
          if (old) fd.append('replaces_part_id', old.id);
          await upload(`/library/marchas/${id}/parts`, fd);
        }
      }
      if (mode === 'audio') {
        for (const [n, a] of audio.entries()) {
          setBusy(`Subiendo ${n + 1} de ${audio.length}…`);
          const fd = new FormData();
          fd.append('file', a); fd.append('label', fromFileName(a.name) || 'Grabación'); fd.append('kind', 'banda');
          await upload(`/library/marchas/${id}/recordings`, fd);
        }
        setBusy(''); setFinished(true); return;
      }
      setBusy('');
      // y ahora, que suene: se leen las notas de cada sección
      setNotes(true);
    } catch (e) { setBusy(''); toast({ kind: 'error', text: (e as Error).message }); }
  };

  if (finished && marchaId) return (
    <div className="page stack lg" style={{ maxWidth: 640 }}>
      <div className="card stack" style={{ alignItems: 'center', textAlign: 'center', padding: 28 }}>
        <CheckCircle2 size={48} color="var(--ok)" />
        <h2 style={{ margin: 0 }}>«{title}» lista</h2>
        <p className="muted" style={{ margin: 0 }}>{mode === 'audio' ? 'La grabación ya se puede escuchar desde la marcha.' : 'Cada músico verá su parte y podrá escucharla con su sonido.'}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link className="btn primary lg" to={`/tocar/${marchaId}`}><Play size={18} /> Escuchar</Link>
          <Link className="btn lg" to={`/marchas/${marchaId}`}>Ver la ficha</Link>
        </div>
      </div>
    </div>
  );

  return (
    <div className="page stack lg" style={{ maxWidth: 760 }}>
      <div className="page-head"><div><div className="eyebrow"><Link to="/biblioteca">Marchas</Link></div><h1>{TITLES[mode]}</h1></div></div>
      {mode === 'pdf' && <Notice kind="info">Sube el PDF con todas las partes. La app lee qué páginas son de cada instrumento y voz (corneta 1ª, 2ª, trompeta…), y después saca las notas para que cada uno pueda escuchar la suya.</Notice>}
      {mode === 'carpeta' && <Notice kind="info">Elige todos los PDF de la marcha a la vez (uno por instrumento o voz). La app reconoce de quién es cada uno por su rótulo o por el nombre del archivo.</Notice>}

      {mode === 'pdf' && <label className="btn lg primary" style={{ alignSelf: 'flex-start' }}><Plus size={18} /> {file ? 'Cambiar PDF' : 'Elegir PDF'}<input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => pickPdf(e.target.files?.[0] ?? null)} /></label>}
      {mode === 'carpeta' && <label className="btn lg primary" style={{ alignSelf: 'flex-start' }}><Plus size={18} /> {files.length ? 'Añadir más PDF' : 'Elegir los PDF'}<input type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => pickMany(e.target.files)} /></label>}
      {mode === 'audio' && <label className="btn lg primary" style={{ alignSelf: 'flex-start' }}><Plus size={18} /> Elegir audio o vídeo<input type="file" accept="audio/*,video/mp4,video/quicktime,.mp3,.m4a,.wav,.ogg,.mp4,.mov" multiple hidden onChange={(e) => setAudio([...audio, ...(e.target.files ?? [])])} /></label>}
      {reading && <p className="muted">Leyendo la partitura…</p>}

      <div className="card stack">
        <Field label="Título de la marcha"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: Bulerías en San Román" /></Field>
        <Field label="Compositor (opcional)"><input className="input" value={composer} onChange={(e) => setComposer(e.target.value)} /></Field>
      </div>

      {mode === 'pdf' && sections.length > 0 && (
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Secciones ({pageCount} páginas)</h3>
          {sections.map((s, i) => (
            <div key={i} className="sec-row">
              <span className="small muted">Págs.</span>
              <input className="input xs" type="number" min={1} max={pageCount} value={s.from} onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, from: Number(e.target.value) } : x)))} />
              <span className="small muted">a</span>
              <input className="input xs" type="number" min={1} max={pageCount} value={s.to} onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, to: Number(e.target.value) } : x)))} />
              <select className={`input ${s.key ? '' : 'need'}`} value={s.key} onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}>
                <option value="">¿De quién es?</option>{opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <button className="btn icon ghost sm" aria-label="Quitar sección" onClick={() => setSections(sections.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div>
          ))}
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setSections([...sections, { key: '', from: pageCount, to: pageCount }])}><Plus size={14} /> Añadir sección</button>
          {sections.some((s) => !s.key) && <p className="small" style={{ color: 'var(--warn)', margin: 0 }}>Indica de quién es cada sección marcada.</p>}
        </div>
      )}

      {mode === 'carpeta' && files.length > 0 && (
        <div className="card stack">
          <h3 style={{ margin: 0 }}>{files.length} partituras</h3>
          {files.map((f, i) => (
            <div key={i} className="sec-row">
              <span className="small ellipsis grow" style={{ minWidth: 0 }}>{f.file.name}</span>
              <select className={`input ${f.key ? '' : 'need'}`} value={f.key} onChange={(e) => setFiles(files.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}>
                <option value="">¿De quién es?</option>{opts.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <button className="btn icon ghost sm" aria-label="Quitar" onClick={() => setFiles(files.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}

      {mode === 'audio' && audio.length > 0 && (
        <div className="card stack">{audio.map((a, i) => <div key={i} className="sec-row"><span className="small ellipsis grow">{a.name}</span><button className="btn icon ghost sm" aria-label="Quitar" onClick={() => setAudio(audio.filter((_, j) => j !== i))}><Trash2 size={16} /></button></div>)}</div>
      )}

      <button className="btn primary lg" disabled={!ready || !!busy} onClick={save}>{busy || (mode === 'vacia' ? 'Crear marcha' : mode === 'audio' ? 'Guardar' : 'Guardar y sacar el sonido')}</button>
      {notes && marchaId && <GenerateNotes auto marchaId={marchaId} onClose={() => { setNotes(false); setFinished(true); }} />}
    </div>
  );
}
