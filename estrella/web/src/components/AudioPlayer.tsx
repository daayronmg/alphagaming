import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Repeat, Volume2, VolumeX, Headphones, Bookmark, X, Rewind } from './icons';
import { fileUrl } from '../lib/api';

const fmt = (s: number) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');

/**
 * Reproductor de grabaciones existentes: velocidad conservando el tono (cuando el navegador lo permite),
 * bucle A–B, marcadores de pasajes y mezcla por pistas cuando hay pistas separadas.
 */
export default function AudioPlayer({ tracks, storageKey }: { tracks: { id: string; file_id: string; label: string; kind: string }[]; storageKey: string }) {
  const multi = tracks.length > 1 && tracks.every((t) => t.kind === 'pista');
  const audios = useRef<(HTMLAudioElement | null)[]>([]);
  const [main, setMain] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [vol, setVol] = useState<number[]>(tracks.map(() => 1));
  const [mute, setMute] = useState<boolean[]>(tracks.map(() => false));
  const [solo, setSolo] = useState<number | null>(null);
  const [marks, setMarks] = useState<{ t: number; label: string }[]>(() => { try { return JSON.parse(localStorage.getItem(`marks:${storageKey}`) || '[]'); } catch { return []; } });
  useEffect(() => { localStorage.setItem(`marks:${storageKey}`, JSON.stringify(marks)); }, [marks, storageKey]);

  const active = multi ? tracks.map((_, i) => i) : [main];
  const els = () => active.map((i) => audios.current[i]).filter(Boolean) as HTMLAudioElement[];

  useEffect(() => {
    for (const a of els()) { a.playbackRate = rate; (a as any).preservesPitch = true; (a as any).webkitPreservesPitch = true; }
  }, [rate, main]); // eslint-disable-line
  useEffect(() => {
    tracks.forEach((_, i) => { const a = audios.current[i]; if (a) a.volume = (solo != null ? (solo === i ? 1 : 0) : mute[i] ? 0 : 1) * vol[i]; });
  }, [vol, mute, solo, tracks]);

  const onTime = () => {
    const a = audios.current[active[0]];
    if (!a) return;
    setT(a.currentTime);
    if (loop.a != null && loop.b != null && a.currentTime >= loop.b) els().forEach((x) => (x.currentTime = loop.a!));
    // pistas: corrige la deriva entre pistas
    if (multi) for (const x of els()) if (x !== a && Math.abs(x.currentTime - a.currentTime) > 0.08) x.currentTime = a.currentTime;
  };
  const toggle = async () => {
    if (playing) { els().forEach((x) => x.pause()); setPlaying(false); return; }
    try { await Promise.all(els().map((x) => x.play())); setPlaying(true); } catch { /* interacción requerida */ }
  };
  const seek = (s: number) => els().forEach((x) => (x.currentTime = s));

  if (!tracks.length) return <p className="small muted">No hay grabaciones disponibles para esta marcha.</p>;
  return (
    <div className="stack">
      {tracks.map((tr, i) => (
        <audio key={tr.id} ref={(el) => (audios.current[i] = el)} src={fileUrl(tr.file_id)} preload="metadata"
          onLoadedMetadata={(e) => i === active[0] && setDur((e.target as HTMLAudioElement).duration)} onTimeUpdate={i === active[0] ? onTime : undefined}
          onEnded={() => setPlaying(false)} />
      ))}
      {!multi && tracks.length > 1 && (
        <div className="chips">{tracks.map((tr, i) => <button key={tr.id} className={`chip ${main === i ? 'on' : ''}`} onClick={() => { els().forEach((x) => x.pause()); setPlaying(false); setMain(i); }}>{tr.label}</button>)}</div>
      )}
      <div className="row nowrap">
        <button className="btn icon" onClick={() => seek(Math.max(0, t - 5))} aria-label="Atrás 5 s"><Rewind size={18} /></button>
        <button className="btn primary icon lg" style={{ width: 54 }} onClick={toggle} aria-label={playing ? 'Pausa' : 'Reproducir'}>{playing ? <Pause size={22} /> : <Play size={22} />}</button>
        <span className="mono small">{fmt(t)}</span>
        <input type="range" className="grow" min={0} max={dur || 0} step={0.1} value={t} onChange={(e) => seek(Number(e.target.value))} aria-label="Posición" />
        <span className="mono small">{fmt(dur)}</span>
      </div>
      <div className="row">
        <span className="small muted">Velocidad</span>
        {[0.5, 0.75, 0.9, 1, 1.1].map((r) => <button key={r} className={`chip ${rate === r ? 'on' : ''}`} onClick={() => setRate(r)}>{r === 1 ? 'Normal' : `${Math.round(r * 100)}%`}</button>)}
        <span className="badge">{rate < 1 ? 'Modo estudio lento' : ''}</span>
      </div>
      <div className="row">
        <button className={`btn sm ${loop.a != null ? 'on' : ''}`} onClick={() => setLoop({ a: t, b: null })}><Repeat size={14} /> Inicio A {loop.a != null && `(${fmt(loop.a)})`}</button>
        <button className={`btn sm ${loop.b != null ? 'on' : ''}`} disabled={loop.a == null} onClick={() => setLoop({ ...loop, b: t > (loop.a ?? 0) ? t : null })}>Fin B {loop.b != null && `(${fmt(loop.b)})`}</button>
        {loop.a != null && <button className="btn sm ghost" onClick={() => setLoop({ a: null, b: null })}><X size={14} /> Quitar bucle</button>}
        <button className="btn sm" onClick={() => { const label = prompt('Nombre del marcador (p. ej. «entrada difícil»):'); if (label) setMarks([...marks, { t, label }].sort((a, b) => a.t - b.t)); }}><Bookmark size={14} /> Marcar pasaje</button>
      </div>
      {marks.length > 0 && <div className="chips">{marks.map((m, i) => <span key={i} className="chip" onClick={() => seek(m.t)}>{fmt(m.t)} · {m.label} <X size={12} onClick={(e) => { e.stopPropagation(); setMarks(marks.filter((_, j) => j !== i)); }} /></span>)}</div>}
      {multi && (
        <div className="stack sm">
          <div className="xs faint" style={{ textTransform: 'uppercase', letterSpacing: '.1em' }}>Pistas</div>
          {tracks.map((tr, i) => (
            <div key={tr.id} className="row nowrap">
              <span className="small grow ellipsis">{tr.label}</span>
              <button className={`btn icon sm ${solo === i ? 'on' : ''}`} onClick={() => setSolo(solo === i ? null : i)} title="Escuchar solo esta voz"><Headphones size={14} /></button>
              <button className={`btn icon sm ${mute[i] ? 'on' : ''}`} onClick={() => setMute(mute.map((m, j) => (j === i ? !m : m)))} title="Silenciar">{mute[i] ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
              <input type="range" min={0} max={1} step={0.05} value={vol[i]} onChange={(e) => setVol(vol.map((v, j) => (j === i ? Number(e.target.value) : v)))} style={{ width: 110 }} aria-label={`Volumen ${tr.label}`} />
            </div>
          ))}
          <p className="xs muted">Consejo: escucha tu voz aislada (auriculares) y después ve subiendo el resto de pistas.</p>
        </div>
      )}
    </div>
  );
}
