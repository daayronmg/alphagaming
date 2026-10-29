import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Trash2 } from './icons';

/** Grabación breve de voz (máx. 60 s). Solo se activa si el usuario concede el micrófono. */
export default function Recorder({ onChange, max = 60 }: { onChange: (b: Blob | null) => void; max?: number }) {
  const [state, setState] = useState<'idle' | 'rec' | 'done'>('idle');
  const [secs, setSecs] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const mr = useRef<MediaRecorder | null>(null);
  const timer = useRef<number>();

  useEffect(() => () => { mr.current?.stream.getTracks().forEach((t) => t.stop()); clearInterval(timer.current); if (url) URL.revokeObjectURL(url); }, []); // eslint-disable-line

  const start = async () => {
    setErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        setUrl(URL.createObjectURL(blob)); setState('done'); onChange(blob);
      };
      rec.start(); mr.current = rec; setState('rec'); setSecs(0);
      timer.current = window.setInterval(() => setSecs((s) => { if (s + 1 >= max) { stop(); } return s + 1; }), 1000);
    } catch {
      setErr('No hay permiso para usar el micrófono.');
    }
  };
  const stop = () => { clearInterval(timer.current); if (mr.current?.state === 'recording') mr.current.stop(); };
  const clear = () => { if (url) URL.revokeObjectURL(url); setUrl(null); setState('idle'); onChange(null); };

  return (
    <div className="row">
      {state === 'idle' && <button type="button" className="btn sm" onClick={start}><Mic size={16} /> Grabar audio</button>}
      {state === 'rec' && <button type="button" className="btn sm danger" onClick={stop}><Square size={14} /> Detener ({secs}s)</button>}
      {state === 'done' && url && <><audio src={url} controls style={{ height: 34 }} /><button type="button" className="btn sm icon" onClick={clear} aria-label="Borrar grabación"><Trash2 size={15} /></button></>}
      {err && <span className="small" style={{ color: 'var(--danger)' }}>{err}</span>}
    </div>
  );
}
