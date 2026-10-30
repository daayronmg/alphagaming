// Audio: síntesis de partituras estructuradas, metrónomo preciso y detección de afinación.
import { midiOf, midiToFreq, noteQuarters, type ScoreDoc } from '../../../shared/music';

let ctx: AudioContext | null = null;
export function audioCtx(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Sonido sintético aproximado de metal (no imita una corneta real: sirve para estudiar alturas y ritmo). */
function brass(c: AudioContext, dest: AudioNode, freq: number, t: number, dur: number, vel = 0.8) {
  const o1 = c.createOscillator(); const o2 = c.createOscillator();
  o1.type = 'sawtooth'; o2.type = 'square';
  o1.frequency.value = freq; o2.frequency.value = freq * 1.003;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
  f.frequency.setValueAtTime(freq * 1.5, t); f.frequency.linearRampToValueAtTime(freq * 6, t + 0.05); f.frequency.linearRampToValueAtTime(freq * 3.5, t + Math.max(0.06, dur));
  const g = c.createGain();
  const a = 0.025, rel = 0.06, peak = 0.16 * vel;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak * 0.85, t + Math.max(a, dur - rel)); g.gain.linearRampToValueAtTime(0.0001, t + dur);
  const mix = c.createGain(); mix.gain.value = 0.5;
  o1.connect(f); o2.connect(mix); mix.connect(f); f.connect(g); g.connect(dest);
  o1.start(t); o2.start(t); o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
}
function drum(c: AudioContext, dest: AudioNode, t: number, low = false, vel = 0.8) {
  const len = low ? 0.25 : 0.09;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, low ? 2 : 4);
  const s = c.createBufferSource(); s.buffer = buf;
  const f = c.createBiquadFilter(); f.type = low ? 'lowpass' : 'highpass'; f.frequency.value = low ? 180 : 1800;
  const g = c.createGain(); g.gain.value = 0.6 * vel;
  s.connect(f); f.connect(g); g.connect(dest); s.start(t);
  if (low) { const o = c.createOscillator(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.2); const og = c.createGain(); og.gain.setValueAtTime(0.5 * vel, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(og); og.connect(dest); o.start(t); o.stop(t + 0.3); }
}
function click(c: AudioContext, dest: AudioNode, t: number, accent: boolean) {
  const o = c.createOscillator(); const g = c.createGain();
  o.frequency.value = accent ? 1760 : 1180;
  g.gain.setValueAtTime(accent ? 0.5 : 0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.06);
}

export function playTone(midi: number, dur = 0.8) {
  const c = audioCtx();
  brass(c, c.destination, midiToFreq(midi), c.currentTime + 0.02, dur);
}
export function playMidiSequence(midis: (number | null)[], bpm = 80) {
  const c = audioCtx();
  const beat = 60 / bpm;
  midis.forEach((m, i) => { if (m != null) brass(c, c.destination, midiToFreq(m), c.currentTime + 0.05 + i * beat, beat * 0.9); });
}
export function playRhythm(pattern: [string, boolean][], bpm = 80) {
  const c = audioCtx();
  let t = c.currentTime + 0.1;
  for (const [dur, dotted] of pattern) {
    const q = noteQuarters({ dur: dur as any, dots: dotted ? 1 : 0 }) * (60 / bpm);
    drum(c, c.destination, t, false);
    t += q;
  }
}

export interface ScorePlayback { stop: () => void; setVolume: (v: number) => void }

/**
 * Reproduce una o varias partes estructuradas entre dos compases.
 * Usa un planificador con antelación para mantener el tempo exacto.
 * startAtPerf permite empezar en un instante concreto del reloj (sincronización con el director).
 */
export function playScores(parts: { doc: ScoreDoc; gain: number; perc?: boolean }[], opts: {
  from: number; to: number; tempo: number; loop?: boolean; metronome?: boolean; startDelay?: number;
  onMeasure?: (n: number) => void; onNote?: (id: string | null) => void; onEnd?: () => void;
}): ScorePlayback {
  const c = audioCtx();
  const master = c.createGain(); master.gain.value = 1; master.connect(c.destination);
  const doc0 = parts[0].doc;
  const beatsPerMeasure = doc0.time[0];
  const beatQuarters = 4 / doc0.time[1];
  const secPerQuarter = 60 / opts.tempo / beatQuarters;
  type Ev = { t: number; dur: number; midi: number | null; perc: boolean; gain: number; id: string };
  const measureStarts: { n: number; t: number }[] = [];
  const evs: Ev[] = [];
  let lenSec = 0;
  for (const p of parts) {
    let t = 0;
    for (const m of p.doc.measures.filter((m) => m.n >= opts.from && m.n <= opts.to)) {
      if (p === parts[0]) measureStarts.push({ n: m.n, t });
      const cap = (p.doc.time[0] * 4) / p.doc.time[1];
      let mt = 0;
      for (const n of m.notes) {
        const q = noteQuarters(n);
        const midi = n.rest || !n.step ? null : midiOf(n.step, n.octave!, n.alter ?? 0) + p.doc.transposition;
        evs.push({ t: t + mt * secPerQuarter, dur: q * secPerQuarter, midi, perc: !!p.perc || p.doc.clef === 'percussion', gain: p.gain, id: n.id });
        mt += q;
      }
      t += Math.max(cap, mt) * secPerQuarter;
    }
    lenSec = Math.max(lenSec, t);
  }
  evs.sort((a, b) => a.t - b.t);
  const clicks: number[] = [];
  if (opts.metronome) for (let i = 0; i * secPerQuarter * beatQuarters < lenSec - 1e-6; i++) clicks.push(i * secPerQuarter * beatQuarters);

  let base = c.currentTime + (opts.startDelay ?? 0.15);
  let idx = 0, cidx = 0, midx = 0;
  let stopped = false;
  const timers: number[] = [];
  const tick = () => {
    if (stopped) return;
    const horizon = c.currentTime + 0.25;
    while (idx < evs.length && base + evs[idx].t < horizon) {
      const e = evs[idx++];
      if (e.perc) { if (e.midi != null && e.gain > 0) drum(c, master, base + e.t, e.midi < 64, e.gain); }
      else if (e.midi != null && e.gain > 0) brass(c, master, midiToFreq(e.midi), base + e.t, Math.max(0.05, e.dur * 0.92), e.gain);
      const delay = (base + e.t - c.currentTime) * 1000;
      timers.push(window.setTimeout(() => opts.onNote?.(e.midi != null ? e.id : null), Math.max(0, delay)));
    }
    while (cidx < clicks.length && base + clicks[cidx] < horizon) { click(c, master, base + clicks[cidx], cidx % beatsPerMeasure === 0); cidx++; }
    while (midx < measureStarts.length && base + measureStarts[midx].t < horizon) {
      const ms = measureStarts[midx++];
      timers.push(window.setTimeout(() => opts.onMeasure?.(ms.n), Math.max(0, (base + ms.t - c.currentTime) * 1000)));
    }
    if (idx >= evs.length && cidx >= clicks.length && c.currentTime > base + lenSec) {
      if (opts.loop) { base += lenSec; idx = 0; cidx = 0; midx = 0; } else { opts.onEnd?.(); opts.onNote?.(null); return; }
    }
    timers.push(window.setTimeout(tick, 50));
  };
  tick();
  return {
    stop: () => { stopped = true; timers.forEach(clearTimeout); master.gain.setTargetAtTime(0, c.currentTime, 0.02); setTimeout(() => master.disconnect(), 200); opts.onNote?.(null); },
    setVolume: (v) => { master.gain.value = v; },
  };
}

/** Metrónomo con planificador; puede arrancar en un instante dado del reloj local (ms, performance.now()). */
export function startMetronome(bpm: number, beatsPerMeasure: number, onBeat?: (beat: number) => void, startAtPerfMs?: number): () => void {
  const c = audioCtx();
  const spb = 60 / bpm;
  const perfToCtx = (ms: number) => c.currentTime + (ms - performance.now()) / 1000;
  let next = startAtPerfMs != null ? Math.max(c.currentTime + 0.02, perfToCtx(startAtPerfMs)) : c.currentTime + 0.1;
  let beat = 0;
  let stopped = false;
  const timers: number[] = [];
  const tick = () => {
    if (stopped) return;
    while (next < c.currentTime + 0.2) {
      const b = beat % beatsPerMeasure;
      click(c, c.destination, next, b === 0);
      timers.push(window.setTimeout(() => onBeat?.(b), Math.max(0, (next - c.currentTime) * 1000)));
      next += spb; beat++;
    }
    timers.push(window.setTimeout(tick, 40));
  };
  tick();
  return () => { stopped = true; timers.forEach(clearTimeout); };
}

// ===== Afinador: autocorrelación =====
export function detectPitch(buf: Float32Array, sampleRate: number): number | null {
  let rms = 0;
  for (const v of buf) rms += v * v;
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.01) return null;
  let r1 = 0, r2 = buf.length - 1;
  const th = 0.2;
  for (let i = 0; i < buf.length / 2; i++) if (Math.abs(buf[i]) < th) { r1 = i; break; }
  for (let i = 1; i < buf.length / 2; i++) if (Math.abs(buf[buf.length - i]) < th) { r2 = buf.length - i; break; }
  const b = buf.slice(r1, r2);
  const n = b.length;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) c[i] += b[j] * b[j + i];
  let d = 0;
  while (d < n - 1 && c[d] > c[d + 1]) d++;
  let max = -1, pos = -1;
  for (let i = d; i < n; i++) if (c[i] > max) { max = c[i]; pos = i; }
  if (pos <= 0) return null;
  const x1 = c[pos - 1], x2 = c[pos], x3 = c[pos + 1] ?? x2;
  const a = (x1 + x3 - 2 * x2) / 2, bb = (x3 - x1) / 2;
  const t0 = a ? pos - bb / (2 * a) : pos;
  const f = sampleRate / t0;
  return f > 50 && f < 2500 ? f : null;
}
export function freqToNote(f: number) {
  const midi = 69 + 12 * Math.log2(f / 440);
  const r = Math.round(midi);
  const cents = Math.round((midi - r) * 100);
  const names = ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'Si♭', 'Si'];
  return { midi: r, name: names[((r % 12) + 12) % 12], octave: Math.floor(r / 12) - 1, cents };
}
