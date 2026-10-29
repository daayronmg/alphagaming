import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Timer, Square, Play, Circle, Hand } from '../components/icons';
import { audioCtx, detectPitch, freqToNote, startMetronome } from '../lib/audio';
import { Notice } from '../components/ui';
import { useAuth } from '../lib/auth';

export default function Tools() {
  return (
    <div className="page stack lg">
      <div className="page-head"><div><div className="eyebrow">Academia</div><h1>Herramientas</h1></div></div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}><Tuner /><Metronome /></div>
      <SelfRecorder />
    </div>
  );
}

function Tuner() {
  const { me } = useAuth();
  const transp = me?.assignments.find((a) => a.is_default)?.transposition ?? 0;
  const [on, setOn] = useState(false);
  const [written, setWritten] = useState(transp !== 0);
  const [r, setR] = useState<{ f: number; name: string; octave: number; cents: number } | null>(null);
  const [err, setErr] = useState('');
  const stop = useRef<() => void>();
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const c = audioCtx();
      const src = c.createMediaStreamSource(stream);
      const an = c.createAnalyser(); an.fftSize = 4096; src.connect(an);
      const buf = new Float32Array(an.fftSize);
      let raf = 0;
      const loop = () => {
        an.getFloatTimeDomainData(buf);
        const f = detectPitch(buf, c.sampleRate);
        if (f) {
          // nota escrita para instrumentos transpositores: sonido − transposición
          const fx = written && transp ? f * Math.pow(2, -transp / 12) : f;
          const n = freqToNote(fx);
          setR({ f, name: n.name, octave: n.octave, cents: n.cents });
        }
        raf = requestAnimationFrame(loop);
      };
      loop();
      stop.current = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); src.disconnect(); };
      setOn(true);
    } catch { setErr('No hay acceso al micrófono.'); }
  };
  useEffect(() => () => stop.current?.(), []);
  return (
    <div className="card stack">
      <div className="card-title"><h3><Mic size={18} /> Afinador</h3>
        <button className={`btn ${on ? 'danger' : 'primary'}`} onClick={() => { if (on) { stop.current?.(); setOn(false); setR(null); } else start(); }}>{on ? <><MicOff size={16} /> Detener</> : <><Mic size={16} /> Activar micrófono</>}</button></div>
      {err && <Notice kind="danger">{err}</Notice>}
      <div className="stack" style={{ alignItems: 'center', padding: '10px 0' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '4rem', fontWeight: 700, lineHeight: 1 }}>{r ? `${r.name}${r.octave}` : '—'}</span>
        <span className={`badge ${!r ? '' : Math.abs(r.cents) <= 5 ? 'ok' : Math.abs(r.cents) <= 20 ? 'warn' : 'danger'}`}>{r ? `${r.cents > 0 ? '+' : ''}${r.cents} cents · ${r.f.toFixed(1)} Hz` : 'Toca una nota larga'}</span>
        <div className="tuner-needle" style={{ width: '100%', marginTop: 16 }}><i style={{ left: `calc(${50 + (r?.cents ?? 0)}% - 2px)` }} /></div>
        <div className="row between xs faint" style={{ width: '100%' }}><span>bajo</span><span>afinado</span><span>alto</span></div>
      </div>
      {transp !== 0 && <label className="checkbox"><input type="checkbox" checked={written} onChange={(e) => setWritten(e.target.checked)} /> Mostrar la nota escrita para mi instrumento (transpositor {transp > 0 ? '+' : ''}{transp})</label>}
      <p className="xs faint">Detección por autocorrelación con el micrófono del dispositivo. Funciona mejor con notas largas y sin ruido ambiente; la percusión no tiene altura definida.</p>
    </div>
  );
}

function Metronome() {
  const [bpm, setBpm] = useState(80);
  const [beats, setBeats] = useState(2);
  const [beat, setBeat] = useState<number | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const taps = useRef<number[]>([]);
  const [on, setOn] = useState(false);
  const restart = (b = bpm, n = beats) => { stop.current?.(); stop.current = startMetronome(b, n, setBeat); };
  useEffect(() => { if (on) restart(); return () => {}; }, [bpm, beats]); // eslint-disable-line
  useEffect(() => () => stop.current?.(), []);
  return (
    <div className="card stack">
      <div className="card-title"><h3><Timer size={18} /> Metrónomo</h3>
        <button className={`btn ${on ? 'danger' : 'primary'}`} onClick={() => { if (on) { stop.current?.(); setOn(false); setBeat(null); } else { restart(); setOn(true); } }}>{on ? <><Square size={16} /> Parar</> : <><Play size={16} /> Iniciar</>}</button></div>
      <div className="row" style={{ justifyContent: 'center' }}>{Array.from({ length: beats }).map((_, i) => <span key={i} className={`beat ${beat === i ? 'on' : ''} ${i === 0 ? 'first' : ''}`} style={{ width: 26, height: 26 }} />)}</div>
      <div className="stack" style={{ alignItems: 'center' }}><span style={{ fontFamily: 'var(--font-display)', fontSize: '3.4rem', fontWeight: 700 }}>♩ = {bpm}</span>
        <input type="range" min={30} max={220} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} style={{ width: '100%' }} /></div>
      <div className="row">
        {[60, 72, 80, 90, 100, 120].map((b) => <button key={b} className={`chip ${bpm === b ? 'on' : ''}`} onClick={() => setBpm(b)}>{b}</button>)}
        <select className="input" style={{ width: 'auto' }} value={beats} onChange={(e) => setBeats(Number(e.target.value))}>{[2, 3, 4, 6].map((n) => <option key={n} value={n}>{n} tiempos</option>)}</select>
        <button className="btn" onClick={() => { const now = performance.now(); taps.current = [...taps.current.filter((t) => now - t < 3000), now]; if (taps.current.length > 1) { const iv = (taps.current[taps.current.length - 1] - taps.current[0]) / (taps.current.length - 1); setBpm(Math.round(60000 / iv)); } }}><Hand size={16} /> Marcar tempo</button>
      </div>
    </div>
  );
}

function SelfRecorder() {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [takes, setTakes] = useState<{ url: string; at: Date }[]>([]);
  const [err, setErr] = useState('');
  const start = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(s); const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => { s.getTracks().forEach((t) => t.stop()); setTakes((t) => [{ url: URL.createObjectURL(new Blob(chunks, { type: r.mimeType })), at: new Date() }, ...t].slice(0, 6)); };
      r.start(); setRec(r);
    } catch { setErr('No hay acceso al micrófono.'); }
  };
  return (
    <div className="card stack">
      <div className="card-title"><h3><Circle size={18} /> Grabación personal</h3>
        {rec ? <button className="btn danger" onClick={() => { rec.stop(); setRec(null); }}><Square size={16} /> Detener</button> : <button className="btn primary" onClick={start}><Mic size={16} /> Grabar</button>}</div>
      {err && <Notice kind="danger">{err}</Notice>}
      <p className="small muted">Grábate tocando un pasaje y compáralo con la grabación de referencia de la marcha. Las grabaciones se quedan solo en este dispositivo y no se envían a nadie.</p>
      {takes.map((t, i) => <div key={t.url} className="row"><span className="small muted">Toma {takes.length - i} · {t.at.toLocaleTimeString('es-ES')}</span><audio controls src={t.url} /></div>)}
    </div>
  );
}
