import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload, CheckCircle2, Trash2, ArrowUpToLine, Wand2 } from '../components/icons';
import GenerateNotes from '../components/GenerateNotes';
import { get, upload } from '../lib/api';
import { useAuth } from '../lib/auth';
import { readPdfText } from '../lib/pdf';
import { useLoad, Notice, Field, useToast, Spinner } from '../components/ui';
import { InstrumentVoicePicker } from './MarchaDetail';
import { detectBook, detectInstrument, validateBook, type BookEntry } from '../../../shared/book';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const STATUS: Record<string, string> = { creada: 'Marcha nueva', añadida: 'Parte añadida', nueva_version: 'Nueva versión' };

/** Importa un libreto (un PDF con varias marchas de un instrumento y voz) separando cada marcha. */
export default function ImportBook() {
  const { can } = useAuth();
  const toast = useToast();
  const struct = useLoad(() => get<any[]>('/org/structure'), []);
  const marchas = useLoad(() => get<any[]>('/library/marchas'), []);
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [entries, setEntries] = useState<BookEntry[]>([]);
  const [iv, setIv] = useState<{ instrument_id: number | null; voice_id: number | null }>({ instrument_id: null, voice_id: null });
  const [label, setLabel] = useState('');
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any[] | null>(null);
  const [notes, setNotes] = useState(false);
  const [detected, setDetected] = useState<string | null | undefined>(undefined); // texto de lo leído; null = no encontrado

  const instruments = (struct.data ?? []).flatMap((s) => s.instruments);
  const existing = useMemo(() => new Map((marchas.data ?? []).filter((m) => !m.is_demo).map((m) => [norm(m.title), m])), [marchas.data]);
  const autoLabel = (() => {
    const i = instruments.find((x: any) => x.id === iv.instrument_id);
    const v = i?.voices.find((x: any) => x.id === iv.voice_id);
    return i ? `${i.name}${v ? ` ${v.name}` : ''}` : '';
  })();
  const error = file && entries.length ? validateBook(entries, pageCount) : null;

  if (!can('library.manage')) return <div className="page"><Notice kind="danger">Sin permiso.</Notice></div>;

  const pick = async (f: File | null) => {
    setFile(f); setEntries([]); setDone(null); setPageCount(0); setDetected(undefined);
    if (!f) return;
    setReading(true);
    try {
      const pages = await readPdfText(f);
      setPageCount(pages.length);
      setEntries(detectBook(pages));
      // instrumento y voz: los lee la app del PDF (o del nombre del archivo); la dirección solo lo comprueba
      const d = detectInstrument(pages, f.name);
      const inst = d && instruments.find((i: any) => norm(i.name) === norm(d.instrument));
      if (inst) {
        const voice = d!.voice ? inst.voices.find((v: any) => norm(v.name).startsWith(`${d!.voice}`)) : null;
        setIv({ instrument_id: inst.id, voice_id: voice?.id ?? null });
        setLabel('');
        setDetected(`${inst.name}${voice ? ` ${voice.name}` : ''}`);
      } else setDetected(null);
    } catch { toast({ kind: 'error', text: 'El PDF no se puede leer. Comprueba que no está dañado ni protegido.' }); setFile(null); }
    finally { setReading(false); }
  };
  const set = (i: number, patch: Partial<BookEntry>) => setEntries(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const joinPrev = (i: number) => setEntries(entries.flatMap((e, j) => (j === i ? [] : j === i - 1 ? [{ ...e, to: entries[i].to }] : [e])));
  const submit = async () => {
    if (!file || !iv.instrument_id) return;
    setBusy(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('label', label || autoLabel);
    fd.append('instrument_id', String(iv.instrument_id));
    fd.append('page_count', String(pageCount));
    if (iv.voice_id) fd.append('voice_id', String(iv.voice_id));
    fd.append('entries', JSON.stringify(entries.map((e) => ({ ...e, title: e.title.trim(), composer: e.composer.trim() }))));
    try {
      const r = await upload<{ results: any[] }>('/library/import-book', fd);
      setDone(r.results); marchas.reload();
      toast({ kind: 'ok', text: `${r.results.length} marchas importadas` });
    } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };

  return (
    <div className="page stack lg">
      <div className="page-head"><div><div className="eyebrow"><Link to="/biblioteca">Biblioteca</Link></div><h1>Subir marchas</h1></div></div>
      <Notice kind="info" title="Cómo funciona">
        Sube un PDF con varias marchas de un mismo instrumento y voz (por ejemplo, el libreto de Corneta 3ª). ESTRELLA lee el PDF y averigua{' '}
        <strong>para qué instrumento y voz es</strong>, el título y el autor de cada marcha; <strong>revisa la propuesta antes de importar</strong>. Cada marcha se guarda como un PDF propio. Si la marcha ya existe (mismo título)
        se le añade esta parte o se publica como nueva versión; si no, se crea. El libreto original no se modifica.
      </Notice>
      {done ? (
        <div className="card stack">
          <Notice kind="ok" title="Importación completada">{done.filter((r) => r.status === 'creada').length} marchas nuevas · {done.filter((r) => r.status === 'añadida').length} partes añadidas · {done.filter((r) => r.status === 'nueva_version').length} nuevas versiones.</Notice>
          <div className="table-wrap"><table className="table"><thead><tr><th>Marcha</th><th>Páginas</th><th>Resultado</th></tr></thead>
            <tbody>{done.map((r) => <tr key={r.marcha_id}><td><Link to={`/marchas/${r.marcha_id}`}>{r.title}</Link></td><td>{r.pages}</td><td><span className={`badge ${r.status === 'creada' ? 'ok' : 'info'}`}>{STATUS[r.status]}</span></td></tr>)}</tbody></table></div>
          <p className="xs muted">Para que el directo pueda seguir los compases, marca el mapa de compases de cada parte desde su ficha cuando lo necesites.</p>
          <Notice kind="info" title="¿Quieres que se puedan escuchar?">ESTRELLA puede leer las notas de estos PDF para que cada músico pulse «Reproducir» y oiga su parte con el nombre de cada nota.</Notice>
          <div className="row"><button className="btn primary" onClick={() => setNotes(true)}><Wand2 size={16} /> Sacar las notas ahora</button><Link className="btn" to="/biblioteca">Ir a la biblioteca</Link><button className="btn" onClick={() => { setDone(null); pick(null); }}>Importar otro libreto</button></div>
        </div>
      ) : (
        <>
          <div className="card stack">
            <Field label="Libreto (PDF)"><input className="input" type="file" accept="application/pdf,.pdf" onChange={(e) => pick(e.target.files?.[0] ?? null)} /></Field>
            {detected && <Notice kind="ok" title={`Es para ${detected}`}>Lo ha leído la app del PDF. Si no es así, cámbialo aquí abajo.</Notice>}
            {detected === null && <Notice kind="warn" title="¿Para qué instrumento es?">No lo pone en el PDF ni en el nombre del archivo: elige el instrumento y la voz.</Notice>}
            <InstrumentVoicePicker value={iv} onChange={setIv} />
            <Field label="Nombre de la parte"><input className="input" value={label} placeholder={autoLabel || 'Corneta 3ª'} onChange={(e) => setLabel(e.target.value)} /></Field>
          </div>
          {reading && <Spinner />}
          {entries.length > 0 && (
            <div className="card stack">
              <div className="row between">
                <div className="row"><span className="badge">{pageCount} páginas</span><span className="badge ok">{entries.length} marchas</span>
                  <span className="badge info">{entries.filter((e) => existing.has(norm(e.title))).length} ya existen</span></div>
              </div>
              <div className="table-wrap"><table className="table"><thead><tr><th>Páginas</th><th>Título</th><th>Autor (según el PDF)</th><th></th><th></th></tr></thead>
                <tbody>{entries.map((e, i) => (
                  <tr key={i}>
                    <td className="nowrap"><div className="row nowrap" style={{ gap: 4 }}>
                      <input className="input" style={{ width: 62 }} type="number" min={1} max={pageCount} value={e.from} onChange={(x) => set(i, { from: Number(x.target.value) })} aria-label="Desde la página" />
                      <span className="faint">–</span>
                      <input className="input" style={{ width: 62 }} type="number" min={1} max={pageCount} value={e.to} onChange={(x) => set(i, { to: Number(x.target.value) })} aria-label="Hasta la página" />
                    </div></td>
                    <td><input className="input" value={e.title} onChange={(x) => set(i, { title: x.target.value })} aria-label="Título" /></td>
                    <td><input className="input" value={e.composer} onChange={(x) => set(i, { composer: x.target.value })} aria-label="Autor" /></td>
                    <td>{existing.has(norm(e.title)) ? <span className="badge info">Existe</span> : <span className="badge ok">Nueva</span>}</td>
                    <td className="nowrap">
                      {i > 0 && <button className="btn ghost sm" title="Es continuación de la marcha anterior" onClick={() => joinPrev(i)}><ArrowUpToLine size={14} /></button>}
                      <button className="btn ghost sm" title="No importar" onClick={() => setEntries(entries.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}</tbody></table></div>
              {error && <Notice kind="danger">{error}</Notice>}
              {!iv.instrument_id && <Notice kind="warn">Elige el instrumento (y la voz) del libreto.</Notice>}
              <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy || !!error || !iv.instrument_id} onClick={submit}>
                {busy ? 'Importando…' : <><Upload size={16} /> Importar {entries.length} marchas</>}
              </button>
              <p className="xs faint"><CheckCircle2 size={12} /> Solo se importan las páginas de la lista; las que quites o no cubras se ignoran.</p>
            </div>
          )}
        </>
      )}
      {notes && <GenerateNotes auto onClose={() => setNotes(false)} />}
    </div>
  );
}
