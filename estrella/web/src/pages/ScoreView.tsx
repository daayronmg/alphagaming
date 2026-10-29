import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Play, Square, Repeat, Timer, Pencil, Eye, Undo2, Redo2, ArrowUp, ArrowDown, Plus, Trash2, Copy, Send, History, Download, Columns2, AlertTriangle, Save, RotateCcw,
} from '../components/icons';
import { get, put, post, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Spinner, ErrorBox, Notice, Modal, Field, useToast, Tabs } from '../components/ui';
import { useChannel, useRealtime } from '../lib/realtime';
import StaffView, { ColorLegend } from '../components/StaffView';
import ScoreCanvas from '../components/ScoreCanvas';
import { playScores, type ScorePlayback } from '../lib/audio';
import { toMusicXML } from '../lib/musicxml';
import { fileUrl } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import {
  diffScores, measureFill, measureCapacity, restMeasure, renumber, transposeDiatonic, uid, keyAlter, noteName, DUR_ES, KEY_NAMES, STEPS,
  type ScoreDoc, type Note, type Dur, type Articulation, type Dynamic,
} from '../../../shared/music';

const DURS: Dur[] = ['w', 'h', 'q', '8', '16', '32'];
const ARTS: { a: Articulation; l: string }[] = [{ a: 'staccato', l: 'Picado' }, { a: 'accent', l: 'Acento' }, { a: 'tenuto', l: 'Tenuto' }, { a: 'marcato', l: 'Marcato' }, { a: 'fermata', l: 'Calderón' }];
const DYNS: Dynamic[] = ['pp', 'p', 'mp', 'mf', 'f', 'ff', 'sfz'];
const clone = <T,>(x: T): T => structuredClone(x);

export default function ScoreView() {
  const { scoreId } = useParams();
  const { can, me } = useAuth();
  const toast = useToast();
  const s = useLoad(() => get(`/scores/${scoreId}`), [scoreId]);
  const editorAllowed = can('scores.publish');
  const [edit, setEdit] = useState(false);
  const [doc, setDoc] = useState<ScoreDoc | null>(null);
  const [rev, setRev] = useState(0);
  const hist = useRef<{ past: ScoreDoc[]; future: ScoreDoc[] }>({ past: [], future: [] });
  const [sel, setSel] = useState<{ noteId: string | null; measureId: string | null }>({ noteId: null, measureId: null });
  const [saving, setSaving] = useState<'guardado' | 'guardando' | 'pendiente' | 'conflicto'>('guardado');
  const [colorMode, setColorMode] = useState(() => localStorage.getItem('estrella.colors') !== '0');
  const [play, setPlay] = useState<ScorePlayback | null>(null);
  const [pm, setPm] = useState<{ measure: number | null; note: string | null }>({ measure: null, note: null });
  const [range, setRange] = useState({ from: 1, to: 999, loop: false, tempoPct: 100, metronome: false });
  const [panel, setPanel] = useState<'versiones' | 'comparar' | null>(null);
  const [viewVersion, setViewVersion] = useState<any | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [newer, setNewer] = useState<any | null>(null);
  const saveTimer = useRef<number>();

  useEffect(() => { localStorage.setItem('estrella.colors', colorMode ? '1' : '0'); }, [colorMode]);
  useChannel(scoreId ? `score:${scoreId}` : null);
  useRealtime((m) => {
    if (m.t === 'score:published' && m.scoreId === scoreId) {
      if (edit) setNewer(m);
      else { s.reload(); toast({ kind: 'info', title: `Nueva versión ${m.number} publicada`, text: m.description }); }
    }
    if (m.t === 'score:draft' && m.scoreId === scoreId && m.byId !== me?.id && edit) { setSaving('conflicto'); toast({ kind: 'error', title: 'Edición simultánea', text: `${m.by} ha guardado cambios en este borrador.` }); }
  }, [scoreId, edit, me?.id]);

  const x = s.data;
  const published: ScoreDoc | null = x?.published ?? null;
  const shown: ScoreDoc | null = viewVersion?.content ?? (edit ? doc : published);
  useEffect(() => () => play?.stop(), [play]);
  useEffect(() => { if (shown) setRange((r) => ({ ...r, to: Math.min(r.to, shown.measures.length) || shown.measures.length })); }, [shown?.measures.length]); // eslint-disable-line

  const startEdit = () => {
    if (!x) return;
    setDoc(clone(x.draft ?? x.published)); setRev(x.draft_rev); hist.current = { past: [], future: [] }; setEdit(true); setViewVersion(null); setSaving('guardado');
  };

  // autoguardado del borrador con control de concurrencia
  const commit = useCallback((next: ScoreDoc) => {
    setDoc((cur) => { if (cur) hist.current.past.push(cur); hist.current.future = []; return next; });
    setSaving('pendiente');
  }, []);
  useEffect(() => {
    if (!edit || !doc || saving !== 'pendiente') return;
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setSaving('guardando');
      try { const r = await put(`/scores/${scoreId}/draft`, { content: doc, rev }); setRev(r.rev); setSaving('guardado'); }
      catch (e) {
        if (e instanceof ApiError && e.status === 409) { setSaving('conflicto'); toast({ kind: 'error', title: 'Conflicto', text: e.message }); }
        else { setSaving('pendiente'); toast({ kind: 'error', text: (e as Error).message }); }
      }
    }, 1200);
    return () => clearTimeout(saveTimer.current);
  }, [doc, saving, edit, rev, scoreId]); // eslint-disable-line

  const undo = () => { const p = hist.current.past.pop(); if (p && doc) { hist.current.future.push(doc); setDoc(p); setSaving('pendiente'); } };
  const redo = () => { const f = hist.current.future.pop(); if (f && doc) { hist.current.past.push(doc); setDoc(f); setSaving('pendiente'); } };

  const loc = useMemo(() => {
    if (!doc || !sel.noteId) return null;
    for (let mi = 0; mi < doc.measures.length; mi++) { const ni = doc.measures[mi].notes.findIndex((n) => n.id === sel.noteId); if (ni >= 0) return { mi, ni }; }
    return null;
  }, [doc, sel.noteId]);
  const selNote = loc && doc ? doc.measures[loc.mi].notes[loc.ni] : null;
  const selMeasureIdx = doc ? doc.measures.findIndex((m) => m.id === (sel.measureId ?? (loc ? doc.measures[loc.mi].id : null))) : -1;

  const updNote = (fn: (n: Note) => Note) => {
    if (!doc || !loc) return;
    const d = clone(doc);
    d.measures[loc.mi].notes[loc.ni] = fn(d.measures[loc.mi].notes[loc.ni]);
    commit(d);
  };
  const step = (k: number) => updNote((n) => {
    if (n.rest) return n;
    const t = transposeDiatonic(n, k);
    return { ...t, alter: keyAlter(t.step!, doc!.key) };
  });
  const insertAfter = () => {
    if (!doc) return;
    const d = clone(doc);
    const mi = loc ? loc.mi : Math.max(0, selMeasureIdx);
    const ref = loc ? d.measures[mi].notes[loc.ni] : null;
    const n: Note = ref && !ref.rest ? { id: uid(), step: ref.step, octave: ref.octave, alter: ref.alter, dur: ref.dur } : { id: uid(), step: 'C', octave: 5, alter: keyAlter('C', d.key), dur: 'q' };
    d.measures[mi].notes.splice(loc ? loc.ni + 1 : d.measures[mi].notes.length, 0, n);
    commit(d); setSel({ noteId: n.id, measureId: d.measures[mi].id });
  };
  const removeNote = () => {
    if (!doc || !loc) return;
    const d = clone(doc);
    d.measures[loc.mi].notes.splice(loc.ni, 1);
    commit(d); setSel({ noteId: null, measureId: d.measures[loc.mi].id });
  };
  const measureOp = (op: 'insert' | 'delete' | 'duplicate' | 'fill' | 'repeatStart' | 'repeatEnd' | 'mark') => {
    if (!doc || selMeasureIdx < 0) return;
    const d = clone(doc);
    const m = d.measures[selMeasureIdx];
    if (op === 'insert') d.measures.splice(selMeasureIdx + 1, 0, restMeasure(0, d.time));
    if (op === 'delete') { if (d.measures.length === 1) return; d.measures.splice(selMeasureIdx, 1); }
    if (op === 'duplicate') {
      const to = Number(prompt('Duplicar desde este compás hasta el compás nº (incluido):', String(m.n)) || m.n);
      const block = d.measures.slice(selMeasureIdx, d.measures.findIndex((x) => x.n === to) + 1 || selMeasureIdx + 1);
      const copies = block.map((b) => ({ ...clone(b), id: uid(), notes: b.notes.map((n) => ({ ...n, id: uid() })), mark: undefined }));
      d.measures.splice(selMeasureIdx + block.length, 0, ...copies);
    }
    if (op === 'fill') {
      const left = measureCapacity(d.time) - measureFill(m);
      if (left > 0) { const r = restMeasure(0, [Math.round(left * d.time[1] / 4 * 100) / 100, d.time[1]] as any); m.notes.push(...r.notes.filter(() => true)); }
    }
    if (op === 'repeatStart') m.repeatStart = !m.repeatStart;
    if (op === 'repeatEnd') m.repeatEnd = !m.repeatEnd;
    if (op === 'mark') { const t = prompt('Nombre de la sección o letra de ensayo (vacío para quitar):', m.mark ?? ''); if (t === null) return; m.mark = t.trim() || undefined; }
    commit(renumber(d));
  };

  // atajos de teclado del editor
  useEffect(() => {
    if (!edit) return;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (!selNote || !doc || !loc) return;
      const flat = doc.measures.flatMap((m) => m.notes.map((n) => ({ n, m })));
      const idx = flat.findIndex((f) => f.n.id === selNote.id);
      if (e.key === 'ArrowUp') { e.preventDefault(); step(e.shiftKey ? 7 : 1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); step(e.shiftKey ? -7 : -1); }
      else if (e.key === 'ArrowRight' && flat[idx + 1]) setSel({ noteId: flat[idx + 1].n.id, measureId: flat[idx + 1].m.id });
      else if (e.key === 'ArrowLeft' && flat[idx - 1]) setSel({ noteId: flat[idx - 1].n.id, measureId: flat[idx - 1].m.id });
      else if (/^[1-6]$/.test(e.key)) updNote((n) => ({ ...n, dur: DURS[Number(e.key) - 1] }));
      else if (e.key === '.') updNote((n) => ({ ...n, dots: n.dots ? 0 : 1 }));
      else if (e.key === '#') updNote((n) => ({ ...n, alter: Math.min(2, (n.alter ?? 0) + 1) }));
      else if (e.key === '-' || e.key === 'b') updNote((n) => ({ ...n, alter: Math.max(-2, (n.alter ?? 0) - 1) }));
      else if (e.key === 'r') updNote((n) => (n.rest ? { ...n, rest: false, step: 'C', octave: 5, alter: 0 } : { id: n.id, rest: true, dur: n.dur, dots: n.dots }));
      else if (e.key === 'Delete' || e.key === 'Backspace') removeNote();
      else if (e.key === 'Insert' || e.key === 'Enter') insertAfter();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }); // eslint-disable-line

  if (s.error) return <div className="page"><ErrorBox error={s.error} retry={s.reload} /></div>;
  if (!x) return <Spinner />;
  if (!shown) return <div className="page"><Notice kind="warn" title="Esta partitura todavía no se ha publicado">{editorAllowed ? <button className="btn sm primary" onClick={startEdit} style={{ marginTop: 8 }}>Editar borrador</button> : 'Estará disponible cuando la dirección la publique.'}</Notice></div>;

  const togglePlay = () => {
    if (play) { play.stop(); setPlay(null); setPm({ measure: null, note: null }); return; }
    const pb = playScores([{ doc: shown, gain: 1 }], {
      from: range.from, to: Math.min(range.to, shown.measures.length), tempo: Math.round(shown.tempo * range.tempoPct / 100), loop: range.loop, metronome: range.metronome,
      onMeasure: (n) => setPm((p) => ({ ...p, measure: n })), onNote: (id) => setPm((p) => ({ ...p, note: id })), onEnd: () => { setPlay(null); setPm({ measure: null, note: null }); },
    });
    setPlay(pb);
  };
  const wrong = shown.measures.filter((m) => Math.abs(measureFill(m) - measureCapacity(shown.time)) > 1e-6);
  const changed = viewVersion?.compareTo ? new Set<string>(diffScores(viewVersion.compareTo, viewVersion.content).flatMap((c) => c.noteIds ?? [])) : undefined;
  const pendingChanges = edit && doc ? diffScores(published, doc) : [];

  const exportXml = () => {
    const blob = new Blob([toMusicXML(shown)], { type: 'application/vnd.recordare.musicxml+xml' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${x.marcha_title} - ${x.label}.musicxml`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="page wide stack" data-testid="score-view" data-version={x.version_number ?? 0}>
      <div className="page-head">
        <div>
          <div className="eyebrow"><Link to={`/marchas/${x.marcha_id}`}>{x.marcha_title}</Link></div>
          <h1>{x.label}</h1>
          <div className="row" style={{ marginTop: 8, gap: 6 }}>
            {x.version_number ? <span className="badge ok" data-testid="score-version">Versión {x.version_number}</span> : <span className="badge warn">Sin publicar</span>}
            {x.published_at && <span className="badge">{fmtDateTime(x.published_at)} · {x.published_by}</span>}
            {viewVersion && <span className="badge info">Viendo versión {viewVersion.number}</span>}
            {edit && <span className={`badge ${saving === 'guardado' ? 'ok' : saving === 'conflicto' ? 'danger' : 'warn'}`}>Borrador: {saving}</span>}
            <span className="badge">{shown.time.join('/')} · {KEY_NAMES[shown.key]} · ♩={shown.tempo}{shown.transposition ? ` · transpositor ${shown.transposition > 0 ? '+' : ''}${shown.transposition}` : ''}</span>
          </div>
        </div>
        <div className="row">
          {x.part_id && <button className={`btn ${panel === 'comparar' ? 'on' : ''}`} onClick={() => setPanel(panel === 'comparar' ? null : 'comparar')}><Columns2 size={16} /> Comparar con PDF</button>}
          <button className={`btn ${panel === 'versiones' ? 'on' : ''}`} onClick={() => setPanel(panel === 'versiones' ? null : 'versiones')}><History size={16} /> Versiones ({x.versions.length})</button>
          <button className="btn" onClick={exportXml}><Download size={16} /> MusicXML</button>
          {editorAllowed && !edit && <button className="btn primary" onClick={startEdit} data-testid="edit-score"><Pencil size={16} /> Editar</button>}
          {edit && <button className="btn" onClick={() => { setEdit(false); setDoc(null); s.reload(); }}><Eye size={16} /> Salir del editor</button>}
          {edit && <button className="btn primary" disabled={!pendingChanges.length || saving !== 'guardado'} onClick={() => setPublishing(true)} data-testid="publish-score"><Send size={16} /> Publicar versión</button>}
        </div>
      </div>

      {x.needs_review && <Notice kind="danger" title="Requiere revisión">Esta versión procede de un reconocimiento automático o importación con avisos. Revisa todas las notas comparándolas con el PDF original antes de publicar.</Notice>}
      {newer && <Notice kind="warn" title={`Otra persona ha publicado la versión ${newer.number}`}>Tu borrador está basado en una versión anterior. <button className="btn sm" onClick={() => { setNewer(null); setEdit(false); s.reload(); }}>Cargar la nueva versión</button></Notice>}
      {saving === 'conflicto' && <Notice kind="danger" title="Conflicto de edición">El borrador ha sido modificado por otra persona. No se han sobrescrito sus cambios. <button className="btn sm" onClick={() => { exportXml(); }}>Exportar mi copia</button> <button className="btn sm" onClick={async () => { await s.reload(); setEdit(false); }}>Descartar y recargar</button></Notice>}
      {wrong.length > 0 && <Notice kind="warn">Compases con duración incorrecta: {wrong.map((m) => m.n).join(', ')}{edit ? ' (selecciónalos y usa «Completar con silencios» o ajusta las figuras).' : ''}</Notice>}

      <div className="card flat row" style={{ gap: 14 }}>
        <button className={`btn ${play ? 'danger' : 'primary'}`} onClick={togglePlay} data-testid="score-play">{play ? <><Square size={16} /> Detener</> : <><Play size={16} /> Reproducir</>}</button>
        <span className="small muted">Compases</span>
        <input className="input" type="number" min={1} style={{ width: 76 }} value={range.from} onChange={(e) => setRange({ ...range, from: Math.max(1, Number(e.target.value)) })} aria-label="Compás inicial" />
        <span>–</span>
        <input className="input" type="number" min={1} style={{ width: 76 }} value={Math.min(range.to, shown.measures.length)} onChange={(e) => setRange({ ...range, to: Number(e.target.value) })} aria-label="Compás final" />
        <button className={`btn sm ${range.loop ? 'on' : ''}`} onClick={() => setRange({ ...range, loop: !range.loop })}><Repeat size={14} /> Bucle</button>
        <button className={`btn sm ${range.metronome ? 'on' : ''}`} onClick={() => setRange({ ...range, metronome: !range.metronome })}><Timer size={14} /> Metrónomo</button>
        <span className="small muted">Tempo</span>
        <input type="range" min={40} max={130} step={5} value={range.tempoPct} onChange={(e) => setRange({ ...range, tempoPct: Number(e.target.value) })} />
        <span className="small mono">{range.tempoPct}% (♩={Math.round(shown.tempo * range.tempoPct / 100)})</span>
        {range.tempoPct < 100 && <span className="badge accent">Estudio lento</span>}
        <span className="grow" />
        <label className="checkbox"><input type="checkbox" checked={colorMode} onChange={(e) => setColorMode(e.target.checked)} /> Colores de notas</label>
      </div>
      {colorMode && <ColorLegend />}
      <p className="xs faint">Reproducción sintética generada a partir de los datos de la partitura (no es una grabación de la banda).</p>

      <div className={panel ? 'grid cols-2' : ''} style={panel ? { gridTemplateColumns: 'minmax(0, 1.4fr) minmax(320px, 1fr)', alignItems: 'start' } : undefined}>
        <div className="stack">
          {edit && doc && (
            <div className="card flat stack sm" data-testid="note-editor">
              <div className="row">
                <button className="btn icon sm" onClick={undo} disabled={!hist.current.past.length} aria-label="Deshacer"><Undo2 size={15} /></button>
                <button className="btn icon sm" onClick={redo} disabled={!hist.current.future.length} aria-label="Rehacer"><Redo2 size={15} /></button>
                <span className="sep-v" style={{ width: 1, height: 24, background: 'var(--line-2)' }} />
                {selNote ? <>
                  <strong className="small">{noteName(selNote)} · {DUR_ES[selNote.dur]}{selNote.dots ? ' con puntillo' : ''}</strong>
                  <button className="btn icon sm" onClick={() => step(1)} title="Subir (↑)" aria-label="Subir nota" data-testid="note-up"><ArrowUp size={15} /></button>
                  <button className="btn icon sm" onClick={() => step(-1)} title="Bajar (↓)" aria-label="Bajar nota" data-testid="note-down"><ArrowDown size={15} /></button>
                  <select className="input" style={{ width: 'auto', minHeight: 32 }} value={selNote.rest ? '' : selNote.step} disabled={selNote.rest} onChange={(e) => updNote((n) => ({ ...n, step: e.target.value as any, alter: keyAlter(e.target.value as any, doc.key) }))}>{STEPS.map((st) => <option key={st} value={st}>{noteName({ step: st, alter: 0 }, false)}</option>)}</select>
                  <input className="input" type="number" min={2} max={7} style={{ width: 64, minHeight: 32 }} value={selNote.octave ?? ''} disabled={selNote.rest} onChange={(e) => updNote((n) => ({ ...n, octave: Number(e.target.value) }))} aria-label="Octava" />
                  {[-1, 0, 1].map((a) => <button key={a} className={`btn sm ${(selNote.alter ?? 0) === a && !selNote.rest ? 'on' : ''}`} disabled={selNote.rest} onClick={() => updNote((n) => ({ ...n, alter: a }))}>{a === -1 ? '♭' : a === 0 ? '♮' : '♯'}</button>)}
                </> : <span className="small muted">Toca una nota para editarla, o un compás para operar con él.</span>}
              </div>
              {selNote && <div className="row">
                {DURS.map((d, i) => <button key={d} className={`btn sm ${selNote.dur === d ? 'on' : ''}`} onClick={() => updNote((n) => ({ ...n, dur: d }))} title={`${DUR_ES[d]} (${i + 1})`}>{DUR_ES[d]}</button>)}
                <button className={`btn sm ${selNote.dots ? 'on' : ''}`} onClick={() => updNote((n) => ({ ...n, dots: n.dots ? 0 : 1 }))}>Puntillo</button>
                <button className={`btn sm ${selNote.rest ? 'on' : ''}`} onClick={() => updNote((n) => (n.rest ? { ...n, rest: false, step: 'C', octave: 5, alter: keyAlter('C', doc.key) } : { id: n.id, rest: true, dur: n.dur, dots: n.dots }))}>Silencio</button>
                <button className={`btn sm ${selNote.tie ? 'on' : ''}`} disabled={selNote.rest} onClick={() => updNote((n) => ({ ...n, tie: !n.tie }))}>Ligadura</button>
              </div>}
              {selNote && !selNote.rest && <div className="row">
                {ARTS.map(({ a, l }) => <button key={a} className={`btn sm ${selNote.artic?.includes(a) ? 'on' : ''}`} onClick={() => updNote((n) => ({ ...n, artic: n.artic?.includes(a) ? n.artic.filter((x) => x !== a) : [...(n.artic ?? []), a] }))}>{l}</button>)}
                <select className="input" style={{ width: 'auto', minHeight: 32 }} value={selNote.dyn ?? ''} onChange={(e) => updNote((n) => ({ ...n, dyn: (e.target.value || undefined) as any }))}><option value="">Dinámica</option>{DYNS.map((d) => <option key={d}>{d}</option>)}</select>
              </div>}
              <div className="row">
                <button className="btn sm" onClick={insertAfter}><Plus size={14} /> Nota</button>
                {selNote && <button className="btn sm" onClick={removeNote}><Trash2 size={14} /> Eliminar nota</button>}
                {selMeasureIdx >= 0 && <>
                  <span className="small muted">Compás {doc.measures[selMeasureIdx].n}:</span>
                  <button className="btn sm" onClick={() => measureOp('insert')}><Plus size={14} /> Compás</button>
                  <button className="btn sm" onClick={() => measureOp('duplicate')}><Copy size={14} /> Duplicar fragmento</button>
                  <button className="btn sm" onClick={() => measureOp('fill')}>Completar con silencios</button>
                  <button className="btn sm" onClick={() => measureOp('mark')}>Sección…</button>
                  <button className={`btn sm ${doc.measures[selMeasureIdx].repeatStart ? 'on' : ''}`} onClick={() => measureOp('repeatStart')}>|: Repetición</button>
                  <button className={`btn sm ${doc.measures[selMeasureIdx].repeatEnd ? 'on' : ''}`} onClick={() => measureOp('repeatEnd')}>Repetición :|</button>
                  <button className="btn sm danger" onClick={() => measureOp('delete')}><Trash2 size={14} /> Compás</button>
                </>}
              </div>
              <details><summary className="small muted">Cabecera (armadura, compás, tempo, clave)</summary>
                <div className="form-grid" style={{ marginTop: 10 }}>
                  <Field label="Armadura"><select className="input" value={doc.key} onChange={(e) => commit({ ...clone(doc), key: Number(e.target.value) })}>{Object.entries(KEY_NAMES).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                  <Field label="Compás"><div className="row nowrap"><input className="input" type="number" min={1} max={16} value={doc.time[0]} onChange={(e) => commit({ ...clone(doc), time: [Number(e.target.value), doc.time[1]] })} />/<select className="input" value={doc.time[1]} onChange={(e) => commit({ ...clone(doc), time: [doc.time[0], Number(e.target.value)] })}><option>2</option><option>4</option><option>8</option></select></div></Field>
                  <Field label="Tempo"><input className="input" type="number" min={20} max={300} value={doc.tempo} onChange={(e) => commit({ ...clone(doc), tempo: Number(e.target.value) })} /></Field>
                  <Field label="Clave"><select className="input" value={doc.clef} onChange={(e) => commit({ ...clone(doc), clef: e.target.value as any })}><option value="treble">Sol</option><option value="bass">Fa</option><option value="percussion">Percusión</option></select></Field>
                  <Field label="Transposición (semitonos)"><input className="input" type="number" value={doc.transposition} onChange={(e) => commit({ ...clone(doc), transposition: Number(e.target.value) })} /></Field>
                </div>
              </details>
              <p className="xs faint">Atajos: ↑↓ altura (⇧ octava) · ←→ nota anterior/siguiente · 1–6 figura · . puntillo · # / b alteración · r silencio · Supr eliminar · Intro insertar · Ctrl+Z deshacer</p>
            </div>
          )}
          <div className="staff-paper" data-testid="staff">
            <StaffView doc={shown} colorMode={colorMode} selectedNoteId={edit ? sel.noteId : null} selectedMeasureId={edit ? sel.measureId : null}
              playingNoteId={pm.note} currentMeasure={pm.measure} loop={range.loop ? { from: range.from, to: range.to } : null} changedNoteIds={changed}
              onNoteClick={edit ? (noteId, measureId) => setSel({ noteId, measureId }) : undefined}
              onMeasureClick={(measureId) => (edit ? setSel({ noteId: null, measureId }) : setRange({ ...range, from: shown.measures.find((m) => m.id === measureId)!.n }))} />
          </div>
        </div>

        {panel === 'versiones' && (
          <div className="card stack sm">
            <div className="card-title"><h3><History size={18} /> Historial de versiones</h3></div>
            {viewVersion && <button className="btn sm" onClick={() => setViewVersion(null)}>Volver a la versión vigente</button>}
            {x.versions.map((v: any, i: number) => (
              <div key={v.id} className="card flat tight stack sm" style={{ borderColor: v.id === x.published_version_id ? 'var(--ok)' : undefined }}>
                <div className="row between"><strong>Versión {v.number}{v.id === x.published_version_id ? ' (vigente)' : ''}</strong><span className="xs faint">{fmtDateTime(v.created_at)}</span></div>
                <div className="small">{v.description}</div>
                <div className="xs muted">Autor: {v.author ?? '—'}{v.restored_from ? ' · restauración' : ''}</div>
                {v.changes.length > 0 && <ul className="xs muted" style={{ margin: 0, paddingLeft: 18 }}>{v.changes.slice(0, 8).map((c: any, j: number) => <li key={j}>{c.measure ? `c.${c.measure}: ` : ''}{c.detail}</li>)}{v.changes.length > 8 && <li>… y {v.changes.length - 8} más</li>}</ul>}
                <div className="row">
                  <button className="btn sm" onClick={async () => { const full = await get(`/scores/${x.id}/versions/${v.id}`); const prev = x.versions[i + 1] ? (await get(`/scores/${x.id}/versions/${x.versions[i + 1].id}`)).content : null; setViewVersion({ ...full, compareTo: prev }); }}><Eye size={14} /> Ver{x.versions[i + 1] ? ' cambios' : ''}</button>
                  {editorAllowed && v.id !== x.published_version_id && <button className="btn sm" onClick={async () => { if (!confirm(`¿Restaurar la versión ${v.number}? Se publicará como una versión nueva.`)) return; await post(`/scores/${x.id}/restore`, { version_id: v.id }); setViewVersion(null); s.reload(); toast({ kind: 'ok', text: 'Versión restaurada y publicada' }); }}><RotateCcw size={14} /> Restaurar</button>}
                </div>
              </div>
            ))}
          </div>
        )}
        {panel === 'comparar' && x.part_id && <ComparePdf partId={x.part_id} />}
      </div>

      {publishing && doc && <PublishModal changes={pendingChanges} onClose={() => setPublishing(false)} onPublish={async (description) => {
        try {
          if (saving !== 'guardado') throw new Error('Espera a que se guarde el borrador.');
          const r = await post(`/scores/${scoreId}/publish`, { description, rev });
          toast({ kind: 'ok', title: `Versión ${r.number} publicada`, text: 'Los músicos reciben la actualización automáticamente.' });
          setPublishing(false); setEdit(false); setDoc(null); s.reload();
        } catch (e) { toast({ kind: 'error', text: (e as Error).message }); }
      }} />}
    </div>
  );
}

function PublishModal({ changes, onClose, onPublish }: { changes: any[]; onClose: () => void; onPublish: (d: string) => void }) {
  const [d, setD] = useState('');
  return (
    <Modal title="Publicar nueva versión oficial" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={d.trim().length < 3} onClick={() => onPublish(d.trim())} data-testid="publish-confirm"><Save size={16} /> Publicar</button></>}>
      <div className="stack">
        <Notice kind="warn">Los cambios estructurales solo llegan a los músicos al publicar. Queda registrado el autor, la fecha, los compases afectados y la versión anterior (restaurable).</Notice>
        <div className="card flat tight" style={{ maxHeight: 220, overflow: 'auto' }}>
          <strong className="small">Cambios ({changes.length})</strong>
          <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{changes.map((c, i) => <li key={i}>{c.measure ? `Compás ${c.measure}: ` : ''}{c.detail}</li>)}</ul>
        </div>
        <Field label="Descripción del cambio"><textarea className="input" value={d} onChange={(e) => setD(e.target.value)} placeholder="Corregida la nota del compás 12 (Sol en lugar de La)" data-testid="publish-description" /></Field>
      </div>
    </Modal>
  );
}

function ComparePdf({ partId }: { partId: string }) {
  const p = useLoad(() => get(`/library/parts/${partId}`), [partId]);
  const [zoom, setZoom] = useState(1);
  if (!p.data) return <Spinner />;
  return (
    <div className="card stack sm" style={{ position: 'sticky', top: 80 }}>
      <div className="row between"><h3>PDF original · {p.data.label}</h3><div className="row"><button className="btn sm" onClick={() => setZoom(Math.max(0.6, zoom - 0.2))}>−</button><button className="btn sm" onClick={() => setZoom(zoom + 0.2)}>+</button></div></div>
      <div style={{ maxHeight: '75vh', overflow: 'auto', background: '#3a3f4b', padding: 10, borderRadius: 12 }}>
        <ScoreCanvas url={fileUrl(p.data.file_id)} kind={p.data.file_kind === 'image' ? 'image' : 'pdf'} zoom={zoom} tool="none" color="#000" width={2} symbol="" annotations={[]} measureMap={p.data.measures_map} highlights={[]} />
      </div>
      <p className="xs faint">El original se conserva siempre sin cambios.</p>
      <AlertTriangle size={0} />
    </div>
  );
}
