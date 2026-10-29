import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, PenTool, Undo2, Star, Eye, Lock, Users, Globe, FileText, Stamp } from './icons';
import { get, put, post, upload, fileUrl } from '../lib/api';
import { useLoad, Spinner, ErrorBox, useToast, Notice } from './ui';
import { useRealtime } from '../lib/realtime';
import Recorder from './Recorder';
import { fmtDateTime, assignmentLabel } from '../lib/format';

type Stroke = { points: [number, number][]; color: string };

/** Lienzo para dibujar sobre la imagen del fragmento (coordenadas normalizadas al recorte). */
export function DrawPad({ src, strokes, onChange, readOnly, height = 220 }: { src: string; strokes: Stroke[]; onChange?: (s: Stroke[]) => void; readOnly?: boolean; height?: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const [cur, setCur] = useState<Stroke | null>(null);
  const curRef = useRef<Stroke | null>(null);
  const pos = (e: React.PointerEvent): [number, number] => { const r = svg.current!.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x * 1000},${y * 1000}`).join(' ');
  return (
    <div style={{ position: 'relative', background: '#fff', borderRadius: 10, overflow: 'hidden', maxHeight: height, display: 'inline-block', maxWidth: '100%' }}>
      <img src={src} alt="Fragmento seleccionado" style={{ display: 'block', maxWidth: '100%', maxHeight: height }} />
      <svg ref={svg} viewBox="0 0 1000 1000" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: readOnly ? 'auto' : 'none', cursor: readOnly ? 'default' : 'crosshair' }}
        onPointerDown={(e) => { if (readOnly) return; (e.target as Element).setPointerCapture(e.pointerId); curRef.current = { points: [pos(e)], color: '#dc2626' }; setCur(curRef.current); }}
        onPointerMove={(e) => { if (!curRef.current) return; curRef.current = { ...curRef.current, points: [...curRef.current.points, pos(e)] }; setCur(curRef.current); }}
        onPointerUp={() => { if (curRef.current && curRef.current.points.length > 1) onChange?.([...strokes, curRef.current]); curRef.current = null; setCur(null); }}>
        {[...strokes, ...(cur ? [cur] : [])].map((s, i) => <path key={i} d={path(s.points)} stroke={s.color} strokeWidth={4} fill="none" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />)}
      </svg>
    </div>
  );
}

const VIS: Record<string, { label: string; icon: any }> = {
  private: { label: 'Privada', icon: Lock },
  section: { label: 'Compartida con la sección', icon: Users },
  band: { label: 'Compartida con toda la banda', icon: Globe },
};

export default function DoubtThread({ id, onOpenInScore, compact }: { id: string; onOpenInScore?: (d: any) => void; compact?: boolean }) {
  const toast = useToast();
  const d = useLoad(() => get(`/doubts/${id}`), [id]);
  const [text, setText] = useState('');
  const [audio, setAudio] = useState<Blob | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recKey, setRecKey] = useState(0);
  useRealtime((m) => { if ((m.t === 'doubt:reply' || m.t === 'doubt:updated') && m.doubtId === id) d.reload(); }, [id]);

  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  if (!d.data) return <Spinner />;
  const x = d.data;
  const V = VIS[x.visibility];

  const send = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('payload', JSON.stringify({ text: text || undefined, drawing: strokes.length ? { strokes } : undefined }));
      if (audio) fd.append('audio', audio, 'respuesta.webm');
      await upload(`/doubts/${id}/replies`, fd);
      setText(''); setAudio(null); setStrokes([]); setDrawing(false); setRecKey((k) => k + 1);
      d.reload();
    } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };
  const setMeta = async (body: any) => { try { await put(`/doubts/${id}`, body); d.reload(); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } };
  const promote = async () => {
    const t = prompt('Texto de la indicación oficial que verán los músicos sobre este fragmento:', x.replies_list.filter((r: any) => r.text).slice(-1)[0]?.text ?? '');
    if (!t) return;
    const scope = confirm('¿Mostrarla a toda la sección? (Cancelar = solo en esta parte)') ? 'section' : 'part';
    try { await post(`/doubts/${id}/promote`, { text: t, scope }); toast({ kind: 'ok', text: 'Convertida en anotación oficial' }); d.reload(); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); }
  };

  return (
    <div className="stack" data-testid="doubt-thread">
      <div className="row between">
        <div>
          <div style={{ fontWeight: 700 }}>{x.author_name}</div>
          <div className="xs muted">{x.instrument ? `${x.instrument}${x.voice ? ' · ' + x.voice : ''}` : x.part_label} · {fmtDateTime(x.created_at)}</div>
          {x.author?.assignments?.length > 0 && <div className="xs faint">Asignación: {x.author.assignments.map(assignmentLabel).join(', ')}</div>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className={`badge ${x.status === 'respondida' ? 'ok' : x.status === 'nueva' ? 'warn' : 'info'}`}>{x.status}</span>
          <span className="badge"><V.icon size={12} /> {V.label}</span>
          {x.priority && <span className="badge danger"><Star size={12} /> Prioritaria</span>}
        </div>
      </div>
      <div className="small"><strong>{x.marcha_title}</strong> · {x.part_label} · página {x.page} · {x.measure ? `compás ${x.measure}` : 'compás no identificado (se guardó la zona exacta)'}</div>
      {x.crop_file_id && <div><DrawPad src={fileUrl(x.crop_file_id)} strokes={x.annotation_payload?.strokes ?? []} readOnly /></div>}
      <div className="card flat tight" style={{ background: 'var(--surface-2)' }}><p className="pre">{x.text}</p>{x.audio_file_id && <audio controls src={fileUrl(x.audio_file_id)} style={{ marginTop: 8, width: '100%' }} />}</div>
      {!compact && onOpenInScore && <button className="btn sm" onClick={() => onOpenInScore(x)}><Eye size={15} /> Ver en la partitura</button>}
      {compact && <Link className="btn sm" to={`/partitura/${x.part_id}?duda=${x.id}`}><Eye size={15} /> Abrir la partitura en esa zona</Link>}

      {x.replies_list.map((r: any) => (
        <div key={r.id} className="card flat tight" style={{ borderColor: r.author_id === x.author_id ? 'var(--line)' : 'color-mix(in srgb, var(--accent) 45%, transparent)' }}>
          <div className="xs muted">{r.author_name} · {fmtDateTime(r.created_at)}</div>
          {r.text && <p className="pre" style={{ marginTop: 4 }}>{r.text}</p>}
          {r.audio_file_id && <audio controls src={fileUrl(r.audio_file_id)} style={{ marginTop: 6, width: '100%' }} />}
          {r.attachment_file_id && <a className="btn sm" href={fileUrl(r.attachment_file_id)} target="_blank" rel="noreferrer"><FileText size={14} /> Adjunto</a>}
          {r.drawing?.strokes && x.crop_file_id && <div style={{ marginTop: 6 }}><DrawPad src={fileUrl(x.crop_file_id)} strokes={r.drawing.strokes} readOnly height={180} /></div>}
        </div>
      ))}

      <div className="stack sm">
        <textarea className="input" placeholder={x.can_manage ? 'Responder…' : 'Añadir un comentario…'} value={text} onChange={(e) => setText(e.target.value)} />
        {drawing && x.crop_file_id && <div><div className="xs muted" style={{ marginBottom: 4 }}>Dibuja sobre el fragmento:</div><DrawPad src={fileUrl(x.crop_file_id)} strokes={strokes} onChange={setStrokes} />{strokes.length > 0 && <button className="btn sm ghost" onClick={() => setStrokes(strokes.slice(0, -1))}><Undo2 size={14} /> Deshacer trazo</button>}</div>}
        <div className="row">
          <Recorder key={recKey} onChange={setAudio} />
          {x.crop_file_id && <button className={`btn sm ${drawing ? 'on' : ''}`} onClick={() => setDrawing(!drawing)}><PenTool size={15} /> Dibujar</button>}
          <span className="grow" />
          <button className="btn primary sm" disabled={busy || (!text && !audio && !strokes.length)} onClick={send}><Send size={15} /> Enviar</button>
        </div>
      </div>

      {x.can_manage && (
        <div className="card flat tight stack sm" style={{ background: 'var(--surface-2)' }}>
          <div className="xs faint" style={{ textTransform: 'uppercase', letterSpacing: '.1em' }}>Gestión</div>
          <div className="row">
            <select className="input" style={{ width: 'auto' }} value={x.visibility} onChange={(e) => setMeta({ visibility: e.target.value })}>
              <option value="private">Privada (autor y responsables)</option><option value="section">Compartida con la sección</option><option value="band">Compartida con toda la banda</option>
            </select>
            <button className={`btn sm ${x.priority ? 'on' : ''}`} onClick={() => setMeta({ priority: !x.priority })}><Star size={14} /> Prioritaria</button>
            {x.status !== 'respondida' && <button className="btn sm" onClick={() => setMeta({ status: 'respondida' })}>Marcar respondida</button>}
            <button className="btn sm" onClick={promote} disabled={!!x.promoted_annotation_id}><Stamp size={14} /> {x.promoted_annotation_id ? 'Ya es nota oficial' : 'Convertir en nota oficial'}</button>
          </div>
          {x.visibility !== 'private' && <Notice kind="info">Visible para {x.visibility === 'band' ? 'toda la banda' : 'la sección'}: evita preguntas repetidas.</Notice>}
        </div>
      )}
    </div>
  );
}
