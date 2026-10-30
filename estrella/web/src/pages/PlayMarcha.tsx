import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Play, Square, FileText, ChevronLeft, Info, Wand2, Gauge } from '../components/icons';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Spinner, ErrorBox, Notice, useToast } from '../components/ui';
import StaffView from '../components/StaffView';
import AudioPlayer from '../components/AudioPlayer';
import { playScores, unlockAudio, type ScorePlayback } from '../lib/audio';
import { transcribePdf } from '../lib/pdf';
import { useRealtime } from '../lib/realtime';
import type { ScoreDoc } from '../../../shared/music';

/** Página sencilla de una marcha: reproducir mi parte, ver las notas que me tocan y abrir el PDF. */
export default function PlayMarcha() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const m = useLoad(() => get(`/library/marchas/${id}`), [id]);
  const scoreId = m.data?.mine?.score?.id as string | undefined;
  const score = useLoad(() => (scoreId ? get(`/scores/${scoreId}`) : Promise.resolve(null)), [scoreId]);
  const [playing, setPlaying] = useState(false);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [measure, setMeasure] = useState<number | null>(null);
  const [speed, setSpeed] = useState(() => Number(localStorage.getItem('estrella.speed')) || 100);
  const [names, setNames] = useState(() => localStorage.getItem('estrella.noteNames') !== '0');
  const [metro, setMetro] = useState(false);
  const [busy, setBusy] = useState(false);
  const pb = useRef<ScorePlayback | null>(null);
  const staffBox = useRef<HTMLDivElement>(null);
  const narrow = typeof window !== 'undefined' && window.innerWidth < 600;
  // la partitura acompaña a la música: se desplaza al compás que suena
  useEffect(() => {
    if (measure == null) return;
    staffBox.current?.querySelector('[data-testid=score-measure-highlight]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [measure]);
  useRealtime((x) => { if (['parts:changed', 'score:published'].includes(x.t) && x.marchaId === id) m.reload(); }, [id]);
  useEffect(() => () => pb.current?.stop(), []);
  useEffect(() => { try { localStorage.setItem('estrella.speed', String(speed)); localStorage.setItem('estrella.noteNames', names ? '1' : '0'); } catch { /* */ } }, [speed, names]);

  if (m.error) return <div className="page"><ErrorBox error={m.error} retry={m.reload} /></div>;
  if (!m.data) return <Spinner />;
  const x = m.data;
  const mine = x.mine;
  const doc: ScoreDoc | null = score.data?.published ?? null;
  const review: number[] = score.data?.review_measures ?? [];

  const stop = () => { pb.current?.stop(); pb.current = null; setPlaying(false); setNoteId(null); setMeasure(null); };
  const play = () => {
    if (!doc) return;
    if (playing) return stop();
    unlockAudio();
    const ns = doc.measures.map((mm) => mm.n);
    pb.current = playScores([{ doc, gain: 1 }], {
      from: Math.min(...ns), to: Math.max(...ns), tempo: Math.round((doc.tempo * speed) / 100), metronome: metro,
      onNote: setNoteId, onMeasure: setMeasure, onEnd: () => { setPlaying(false); setMeasure(null); pb.current = null; },
    });
    setPlaying(true);
  };

  // dirección: sacar las notas del PDF de esta parte en el momento
  const makeNotes = async () => {
    const part = mine.part;
    if (!part) return;
    setBusy(true);
    try {
      const pending = await get<any[]>('/scores/pdf/pending?all=1');
      const row = pending.find((r) => r.part_id === part.id);
      const t = await transcribePdf(`/api/files/${part.file_id}`, { title: x.title, transposition: row?.transposition ?? 0, range: part.page_from ? [part.page_from, part.page_to] : null });
      if (!t.notes) throw new Error('Este PDF no tiene las notas como texto musical (no viene de Sibelius o es una imagen escaneada).');
      await post(`/scores/pdf/${part.id}`, { content: t.doc, review: t.review, warnings: t.warnings });
      toast({ kind: 'ok', text: `Notas listas: ${t.doc.measures.length} compases${t.review.length ? `, ${t.review.length} por revisar` : ''}.` });
      m.reload();
    } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };

  return (
    <div className="page stack">
      <div className="row between">
        <Link to="/" className="btn ghost sm"><ChevronLeft size={16} /> Inicio</Link>
        {can('library.manage') && <Link to={`/marchas/${x.id}`} className="btn ghost sm">Ficha completa</Link>}
      </div>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)' }}>{x.title}</h1>
        <div className="muted">{x.composer || ''}{mine.assignment ? `${x.composer ? ' · ' : ''}Tu parte: ${mine.assignment.instrument}${mine.assignment.voice ? ` ${mine.assignment.voice}` : ''}` : ''}</div>
      </div>

      {mine.status !== 'ok' && <Notice kind="warn" title="Tu parte no está disponible">{mine.message}</Notice>}

      {doc ? (
        <div className="card stack play-panel">
          <button className={`btn lg play-big ${playing ? '' : 'primary'}`} onClick={play} data-testid="play-march">
            {playing ? <><Square size={24} /> Parar</> : <><Play size={26} /> Reproducir mi parte</>}
          </button>
          <p className="xs faint" style={{ textAlign: 'center', marginTop: -4 }}>¿No se oye? Sube el volumen del móvil y, en iPhone, quita el modo silencio.</p>
          <div className="row speed-row nowrap">
            <Gauge size={18} className="faint" />
            <input type="range" min={50} max={120} step={5} value={speed} onChange={(e) => { setSpeed(Number(e.target.value)); if (playing) stop(); }} aria-label="Velocidad" />
            <span className="small" style={{ minWidth: 92 }}>{speed === 100 ? 'Velocidad normal' : `${speed} %`}</span>
          </div>
          <div className="row">
            <label className="checkbox"><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> Nombre de las notas</label>
            <label className="checkbox"><input type="checkbox" checked={metro} onChange={(e) => { setMetro(e.target.checked); if (playing) stop(); }} /> Metrónomo</label>
            {mine.part && <Link className="btn sm" to={`/partitura/${mine.part.id}`}><FileText size={15} /> Partitura original</Link>}
          </div>
        </div>
      ) : mine.part ? (
        <div className="card stack">
          {x.recordings.length > 0 ? <AudioPlayer tracks={x.recordings} storageKey={x.id} /> : <p className="muted">Esta marcha aún no tiene sonido para tu parte.</p>}
          <div className="row">
            <Link className="btn primary lg" to={`/partitura/${mine.part.id}`}><FileText size={20} /> Ver mi partitura</Link>
            {can('scores.publish') && <button className="btn lg" disabled={busy} onClick={makeNotes}><Wand2 size={20} /> {busy ? 'Leyendo el PDF…' : 'Sacar las notas del PDF'}</button>}
          </div>
        </div>
      ) : null}

      {doc && (
        <div className="card">
          {score.data?.source === 'pdf' && (
            <p className="xs faint row" style={{ gap: 6, marginBottom: 8 }}><Info size={14} /> Notas leídas del PDF automáticamente.{review.length ? ` Revisa los compases ${review.slice(0, 8).join(', ')}${review.length > 8 ? '…' : ''}: pueden tener algún fallo.` : ''} Ante la duda, manda la partitura original.</p>
          )}
          <p className="xs faint" style={{ marginBottom: 8 }}><span style={{ color: '#dc2626', fontWeight: 700 }}>Rojo</span>: nota en línea · <span style={{ color: '#2563eb', fontWeight: 700 }}>Azul</span>: nota en espacio. La nota que suena se pone verde.</p>
          <div ref={staffBox}><StaffView doc={doc} colorMode noteNames={names} playingNoteId={noteId} currentMeasure={measure} scale={narrow ? 0.78 : 1} /></div>
        </div>
      )}
      {!doc && score.loading && <Spinner />}
    </div>
  );
}
