import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Play, Square, FileText, ChevronLeft, Info, Wand2, Gauge, Pencil, Maximize, Minimize, RotateCw, Video, Lock, Trash2 } from '../components/icons';
import { get, post, put, del } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Spinner, ErrorBox, Notice, useToast, Modal, Field } from '../components/ui';
import StaffView from '../components/StaffView';
import AudioPlayer from '../components/AudioPlayer';
import { playScores, unlockAudio, loadCornetSamples, cornetSamplesReady, type ScorePlayback } from '../lib/audio';
import { transcribePdf } from '../lib/pdf';
import { useRealtime } from '../lib/realtime';
import type { ScoreDoc } from '../../../shared/music';

/** Identificador de un vídeo de YouTube a partir de cualquiera de sus enlaces habituales. */
export function youtubeId(url: string): string | null {
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/.exec(url);
  return m ? m[1] : null;
}

/** «Cómo se toca»: vídeo o audio de referencia de la marcha. La dirección pega el enlace; los músicos lo ven sin salir de la app. */
function HowTo({ marcha, canEdit, onSaved }: { marcha: any; canEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(marcha.how_url ?? '');
  useEffect(() => setUrl(marcha.how_url ?? ''), [marcha.how_url]);
  const yt = marcha.how_url ? youtubeId(marcha.how_url) : null;
  const has = !!marcha.how_url || marcha.recordings.length > 0;
  if (!has && !canEdit) return null;
  const save = async () => {
    const v = url.trim();
    if (v && !/^https:\/\//.test(v)) return toast({ kind: 'error', text: 'Pega el enlace completo, empezando por https://' });
    try { await put(`/library/marchas/${marcha.id}`, { how_url: v || null }); toast({ kind: 'ok', text: v ? 'Guardado: ya lo ven todos.' : 'Enlace quitado.' }); setEditing(false); onSaved(); }
    catch (e) { toast({ kind: 'error', text: (e as Error).message }); }
  };
  return (
    <>
      <button className="btn how-btn" onClick={() => (has ? setOpen(true) : setEditing(true))} data-testid="how-to">
        <Video size={18} /> {has ? 'Cómo se toca' : 'Añadir «Cómo se toca»'}
      </button>
      {open && (
        <Modal title={`Cómo se toca · ${marcha.title}`} onClose={() => setOpen(false)}>
          <div className="stack">
            {yt && <div className="how-video"><iframe src={`https://www.youtube-nocookie.com/embed/${yt}?rel=0&playsinline=1`} title="Cómo se toca" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen /></div>}
            {marcha.how_url && !yt && <a className="btn primary lg" href={marcha.how_url} target="_blank" rel="noopener noreferrer"><Play size={20} /> Abrir el vídeo o audio</a>}
            {marcha.recordings.length > 0 && <AudioPlayer tracks={marcha.recordings} storageKey={marcha.id} />}
            {canEdit && <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setOpen(false); setEditing(true); }}><Pencil size={15} /> Cambiar el enlace</button>}
          </div>
        </Modal>
      )}
      {editing && (
        <Modal title="Cómo se toca esta marcha" onClose={() => setEditing(false)} footer={<><button className="btn" onClick={() => setEditing(false)}>Cancelar</button><button className="btn primary" onClick={save} data-testid="how-save">Guardar</button></>}>
          <div className="stack">
            <p className="small muted">Pega el enlace de un vídeo de YouTube (o de cualquier vídeo o audio) donde se oiga cómo se toca. Los componentes lo verán dentro de la app.</p>
            <Field label="Enlace"><input className="input" type="url" inputMode="url" placeholder="https://youtu.be/…" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

function useMedia(query: string) {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const h = () => setOn(m.matches);
    h(); m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [query]);
  return on;
}

/**
 * Página sencilla de una marcha: reproducir mi parte, ver las notas que me tocan y abrir el PDF.
 * `embedded` la usa el ensayo en directo (pantalla completa, sin enlaces de vuelta).
 */
export default function PlayMarcha({ marchaId, embedded }: { marchaId?: string; embedded?: boolean } = {}) {
  const params = useParams();
  const id = marchaId ?? params.id;
  const { can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const m = useLoad(() => get(`/library/marchas/${id}/play`), [id]);
  // voz que se escucha: la propia; quien no tiene asignación (la dirección) elige entre las publicadas
  const [voice, setVoice] = useState<string | null>(null);
  useEffect(() => setVoice(null), [id]);
  const published = ((m.data?.scores ?? []) as any[]).filter((x) => x.published_version_id);
  const scoreId = (voice ?? m.data?.mine?.score?.id ?? (!m.data?.mine?.assignment ? published[0]?.id : undefined)) as string | undefined;
  const score = useLoad(() => (scoreId ? get(`/scores/${scoreId}?light=1`) : Promise.resolve(null)), [scoreId]);
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
  // móvil en horizontal: la marcha completa en una pantalla
  const land = useMedia('(orientation: landscape) and (max-height: 540px)');
  const phone = useMedia('(max-width: 699px) and (pointer: coarse)');
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const [fitH, setFitH] = useState(0);
  useEffect(() => {
    if (!box) return;
    const ro = new ResizeObserver(() => setFitH(box.clientHeight));
    ro.observe(box); setFitH(box.clientHeight);
    return () => ro.disconnect();
  }, [box]);
  const [full, setFull] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  // la partitura acompaña a la música: se desplaza al compás que suena
  useEffect(() => {
    if (measure == null) return;
    staffBox.current?.querySelector('[data-testid=score-measure-highlight]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [measure]);
  // si la dirección corrige las notas, se ven al momento
  useRealtime((x) => { if (['parts:changed', 'score:published'].includes(x.t) && x.marchaId === id) { m.reload(); score.reload(); } }, [id, scoreId]);
  useEffect(() => () => pb.current?.stop(), []);
  // las notas grabadas de corneta se descargan al abrir la marcha, para que suenen desde la primera nota
  useEffect(() => { loadCornetSamples(); }, []);
  useEffect(() => { try { localStorage.setItem('estrella.speed', String(speed)); localStorage.setItem('estrella.noteNames', names ? '1' : '0'); } catch { /* */ } }, [speed, names]);

  if (m.error) return <div className="page"><ErrorBox error={m.error} retry={m.reload} /></div>;
  if (!m.data) return <Spinner />;
  const x = m.data;
  const mine = x.mine;
  const doc: ScoreDoc | null = score.data?.published ?? null;
  // corneta de llaves Do/Reb: debajo de cada nota, la posición (| Do, — Reb)
  const cornet = /corneta/i.test(published.find((p) => p.id === scoreId)?.label ?? mine.assignment?.instrument ?? '');
  const review: number[] = score.data?.review_measures ?? [];

  const stop = () => { pb.current?.stop(); pb.current = null; setPlaying(false); setNoteId(null); setMeasure(null); };
  const play = async () => {
    if (!doc) return;
    if (playing) return stop();
    unlockAudio();
    // si las notas grabadas aún se están descargando, se espera un momento (como mucho 4 s)
    if (!cornetSamplesReady()) { setPlaying(true); await Promise.race([loadCornetSamples(), new Promise((r) => setTimeout(r, 4000))]); }
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

  const speeds = [100, 90, 80, 70, 60];
  const nextSpeed = () => { setSpeed(speeds[(speeds.indexOf(speed) + 1) % speeds.length] ?? 100); if (playing) stop(); };
  // pantalla completa y, donde el móvil lo permite (Android), giro a horizontal; en iPhone basta con girarlo
  const goFull = async () => {
    if (document.fullscreenElement) { (screen.orientation as any)?.unlock?.(); await document.exitFullscreen?.().catch(() => {}); return; }
    try { await document.documentElement.requestFullscreen?.(); await (screen.orientation as any)?.lock?.('landscape'); }
    catch { if (!land) toast({ kind: 'info', text: 'Gira el móvil en horizontal para ver la marcha completa.' }); }
  };
  const turnHint = phone && !land && doc && (
    <button className="btn sm turn-hint" onClick={goFull}><RotateCw size={15} /> Gira el móvil para ver la marcha completa</button>
  );

  // móvil en horizontal: toda la marcha en una pantalla, con los mandos en una tira arriba
  if (land && doc) {
    return (
      <div className="full-march" data-testid="full-march">
        <div className="full-bar">
          <Link to="/" className="btn icon ghost" aria-label="Salir"><ChevronLeft size={20} /></Link>
          <strong className="grow ellipsis">{x.title}</strong>
          {(published.length > 1 || !mine.assignment) && published.length > 0 && (
            <select className="input full-voice" value={scoreId ?? ''} onChange={(e) => { setVoice(e.target.value); stop(); }} aria-label="Voz">
              {published.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          )}
          <button className={`btn full-btn ${playing ? '' : 'primary'}`} onClick={play} data-testid="play-march">
            {playing ? <><Square size={16} /> Parar</> : <><Play size={16} /> Reproducir</>}
          </button>
          <button className="btn full-btn" onClick={nextSpeed} aria-label="Velocidad">{speed} %</button>
          <button className={`btn full-btn ${names ? 'primary' : ''}`} onClick={() => setNames(!names)} aria-pressed={names}>Notas</button>
          <button className={`btn full-btn ${metro ? 'primary' : ''}`} onClick={() => { setMetro(!metro); if (playing) stop(); }} aria-pressed={metro} aria-label="Metrónomo">Metr.</button>
          {'requestFullscreen' in document.documentElement && (
            <button className="btn icon ghost" onClick={goFull} aria-label="Pantalla completa">{full ? <Minimize size={18} /> : <Maximize size={18} />}</button>
          )}
        </div>
        <div className="full-score" ref={setBox}>
          {fitH > 0 && <StaffView doc={doc} colorMode noteNames={names} cornetKeys={cornet} playingNoteId={noteId} currentMeasure={measure} fitHeight={fitH - 4} />}
        </div>
      </div>
    );
  }

  // ensayo en directo: la partitura ocupa la pantalla y los mandos van en una barra fija abajo (a mano del pulgar)
  // fuera del ensayo, igual de limpia: la marcha entera para leer y escuchar, sin menús alrededor
  if (doc) {
    return (
      <div className={embedded ? 'live-play' : 'live-play solo-play'}>
        {!embedded && (
          <div className="solo-top">
            <button className="btn icon ghost" onClick={() => (history.length > 1 ? nav(-1) : nav('/'))} aria-label="Volver"><ChevronLeft size={22} /></button>
            <div className="grow" />
            {mine.part && <Link className="btn sm ghost" to={`/partitura/${mine.part.id}`}><FileText size={15} /> Original</Link>}
            {can('scores.publish') && scoreId && <Link className="btn sm ghost" to={`/score/${scoreId}`}><Pencil size={15} /> Notas</Link>}
            {can('library.manage') && !x.private && <Link to={`/marchas/${x.id}`} className="btn sm ghost">Ficha</Link>}
            {x.private && <button className="btn sm ghost" onClick={async () => { if (!confirm(`¿Borrar «${x.title}»? Es tuya y solo la ves tú.`)) return; try { await del(`/library/private/marchas/${x.id}`); nav('/'); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } }} aria-label="Borrar"><Trash2 size={15} /></button>}
          </div>
        )}
        <div className="live-title">
          <h1>{x.title}</h1>
          <div className="small muted ellipsis">{mine.assignment ? `Tu parte: ${mine.assignment.instrument}${mine.assignment.voice ? ` ${mine.assignment.voice}` : ''}` : x.composer || ''}</div>
        </div>
        {(published.length > 1 || !mine.assignment) && published.length > 0 && (
          <select className="input" style={{ width: 'auto', alignSelf: 'flex-start' }} value={scoreId ?? ''} onChange={(e) => { setVoice(e.target.value); stop(); }} aria-label="Voz">
            {published.map((p) => <option key={p.id} value={p.id}>{p.label}{p.id === mine.score?.id ? ' (la tuya)' : ''}</option>)}
          </select>
        )}
        {x.private && <span className="badge" style={{ alignSelf: 'flex-start' }}><Lock size={12} /> Marcha tuya: solo la ves tú</span>}
        {mine.status !== 'ok' && mine.assignment && <Notice kind="warn" title="Tu parte no está disponible">{mine.message}</Notice>}
        <div className="row" style={{ gap: 8 }}>{turnHint}<HowTo marcha={x} canEdit={!embedded && can('library.manage')} onSaved={m.reload} /></div>
        <div className="live-score" ref={staffBox}>
          <StaffView doc={doc} colorMode noteNames={names} cornetKeys={cornet} playingNoteId={noteId} currentMeasure={measure} scale={narrow ? 0.6 : 1} />
          <p className="xs faint" style={{ margin: '10px 4px 0' }}>
            <span style={{ color: '#dc2626', fontWeight: 700 }}>Rojo</span>: en línea · <span style={{ color: '#2563eb', fontWeight: 700 }}>Azul</span>: en espacio · Verde: la que suena
            {cornet && names && <> · <b>|</b> posición de Do · <b>—</b> posición de Reb</>}
            {review.length ? ` · Revisa los compases ${review.slice(0, 6).join(', ')}` : ''}
            {!embedded && ' · ¿No se oye? Sube el volumen y quita el modo silencio.'}
          </p>
        </div>
        <div className="live-dock">
          <button className={`btn live-play-btn ${playing ? '' : 'primary'}`} onClick={play} data-testid="play-march">
            {playing ? <><Square size={20} /> Parar</> : <><Play size={22} /> Reproducir</>}
          </button>
          <button className="btn live-chip-btn" onClick={nextSpeed} aria-label="Velocidad"><Gauge size={16} /> {speed} %</button>
          <button className={`btn live-chip-btn ${names ? 'primary' : ''}`} onClick={() => setNames(!names)} aria-pressed={names}>Notas</button>
          <button className={`btn live-chip-btn ${metro ? 'primary' : ''}`} onClick={() => { setMetro(!metro); if (playing) stop(); }} aria-pressed={metro} aria-label="Metrónomo">{narrow ? 'Metr.' : 'Metrónomo'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? 'stack' : 'page stack'}>
      {!embedded && (
        <div className="row between">
          <Link to="/" className="btn ghost sm"><ChevronLeft size={16} /> Inicio</Link>
          {can('library.manage') && !x.private && <Link to={`/marchas/${x.id}`} className="btn ghost sm">Ficha completa</Link>}
          {x.private && <button className="btn ghost sm" onClick={async () => { if (!confirm(`¿Borrar «${x.title}»? Es tuya y solo la ves tú.`)) return; try { await del(`/library/private/marchas/${x.id}`); nav('/'); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } }}><Trash2 size={15} /> Borrar</button>}
        </div>
      )}
      <div>
        <h1>{x.title}</h1>
        {x.private && <span className="badge" style={{ marginBottom: 4 }}><Lock size={12} /> Marcha tuya: solo la ves tú</span>}
        <div className="muted">{x.composer || ''}{mine.assignment ? `${x.composer ? ' · ' : ''}Tu parte: ${mine.assignment.instrument}${mine.assignment.voice ? ` ${mine.assignment.voice}` : ''}` : ''}</div>
      </div>

      {mine.status !== 'ok' && mine.assignment && <Notice kind="warn" title="Tu parte no está disponible">{mine.message}</Notice>}
      {(published.length > 1 || (!mine.assignment && published.length > 0)) && (
        <div className="row">
          <span className="small muted">Voz:</span>
          <select className="input" style={{ width: 'auto' }} value={scoreId ?? ''} onChange={(e) => { setVoice(e.target.value); stop(); }} aria-label="Voz">
            {published.map((p) => <option key={p.id} value={p.id}>{p.label}{p.id === mine.score?.id ? ' (la tuya)' : ''}</option>)}
          </select>
          {can('scores.publish') && scoreId && <Link className="btn sm" to={`/score/${scoreId}`}><Pencil size={15} /> Editar notas</Link>}
        </div>
      )}

      {doc ? (
        <div className="card stack play-panel">
          <button className={`btn lg play-big ${playing ? '' : 'primary'}`} onClick={play} data-testid="play-march">
            {playing ? <><Square size={24} /> Parar</> : <><Play size={26} /> {scoreId === mine.score?.id ? 'Reproducir mi parte' : 'Reproducir'}</>}
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
          <HowTo marcha={x} canEdit={can('library.manage')} onSaved={m.reload} />
        </div>
      ) : mine.part ? (
        <div className="card stack">
          {x.recordings.length > 0 ? <AudioPlayer tracks={x.recordings} storageKey={x.id} /> : <p className="muted">Esta marcha aún no tiene sonido para tu parte.</p>}
          <div className="row">
            <Link className="btn primary lg" to={`/partitura/${mine.part.id}`}><FileText size={20} /> Ver mi partitura</Link>
            {(can('scores.publish') || x.private) && mine.part.file_kind !== 'image' && <button className="btn lg" disabled={busy} onClick={makeNotes}><Wand2 size={20} /> {busy ? 'Leyendo el PDF…' : 'Sacar las notas del PDF'}</button>}
          </div>
        </div>
      ) : null}

      {turnHint}
      {doc && (
        <div className="card">
          {score.data?.source === 'pdf' && (
            <p className="xs faint row" style={{ gap: 6, marginBottom: 8 }}><Info size={14} /> Notas leídas del PDF automáticamente.{review.length ? ` Revisa los compases ${review.slice(0, 8).join(', ')}${review.length > 8 ? '…' : ''}: pueden tener algún fallo.` : ''} Ante la duda, manda la partitura original.</p>
          )}
          <p className="xs faint" style={{ marginBottom: 8 }}><span style={{ color: '#dc2626', fontWeight: 700 }}>Rojo</span>: nota en línea · <span style={{ color: '#2563eb', fontWeight: 700 }}>Azul</span>: nota en espacio. La nota que suena se pone verde.</p>
          <div ref={staffBox}><StaffView doc={doc} colorMode noteNames={names} cornetKeys={cornet} playingNoteId={noteId} currentMeasure={measure} scale={narrow ? 0.78 : 1} /></div>
        </div>
      )}
      {!doc && score.loading && <Spinner />}
    </div>
  );
}
