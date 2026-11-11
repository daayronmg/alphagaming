// Audio: síntesis de partituras estructuradas, metrónomo preciso y detección de afinación.
import { midiOf, midiToFreq, noteQuarters, playOrder, type ScoreDoc } from '../../../shared/music';

let ctx: AudioContext | null = null;
let out: AudioNode | null = null;
let keepAlive: HTMLAudioElement | null = null;

/** WAV de silencio: mantenerlo sonando hace que el iPhone trate la página como reproductor de música (suena aunque esté en silencio). */
function silentWavUrl(): string {
  const rate = 8000, n = rate / 2, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o: number, t: string) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/** Prepara el audio en el mismo toque del usuario (requisito de los móviles). */
export function unlockAudio() {
  try { const s = (navigator as any).audioSession; if (s) s.type = 'playback'; } catch { /* */ }
  if (!keepAlive) {
    keepAlive = new Audio(silentWavUrl());
    keepAlive.loop = true;
    keepAlive.setAttribute('playsinline', '');
  }
  keepAlive.play().catch(() => {});
  audioCtx();
  loadCornetSamples();
}

export function audioCtx(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') ctx.resume().catch(() => {});
  return ctx;
}

/** Salida general con compresor: más volumen sin distorsionar en altavoces de móvil. */
function output(c: AudioContext): AudioNode {
  if (!out) {
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    const g = c.createGain(); g.gain.value = 1.6;
    comp.connect(g); g.connect(c.destination);
    out = comp;
  }
  return out;
}

/** Sonido sintético aproximado de metal (no imita una corneta real: sirve para estudiar alturas y ritmo). */
function brass(c: AudioContext, dest: AudioNode, freq: number, t: number, dur: number, vel = 0.8) {
  const o1 = c.createOscillator(); const o2 = c.createOscillator();
  o1.type = 'sawtooth'; o2.type = 'square';
  o1.frequency.value = freq; o2.frequency.value = freq * 1.003;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
  f.frequency.setValueAtTime(freq * 1.5, t); f.frequency.linearRampToValueAtTime(freq * 6, t + 0.05); f.frequency.linearRampToValueAtTime(freq * 3.5, t + Math.max(0.06, dur));
  const g = c.createGain();
  const a = 0.025, rel = 0.06, peak = 0.32 * vel;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak * 0.85, t + Math.max(a, dur - rel)); g.gain.linearRampToValueAtTime(0.0001, t + dur);
  const mix = c.createGain(); mix.gain.value = 0.5;
  o1.connect(f); o2.connect(mix); mix.connect(f); f.connect(g); g.connect(dest);
  o1.start(t); o2.start(t); o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
}
// ===== Corneta de banda (síntesis) =====
// No es una grabación: imita lo que hace reconocible a la corneta de Semana Santa — timbre brillante y algo nasal,
// ataque picado con un pequeño «quiebro» de afinación, brillo que crece con la fuerza, vibrato ancho en las notas
// largas y el eco de la calle.
let cornetWaveCtx: AudioContext | null = null;
/**
 * Timbre de corneta de llaves por registro, medido sobre una corneta real nota a nota (mediana de los
 * armónicos en cada zona) y algo más brillante para compensar el micrófono del móvil con el que se grabó:
 * manda la fundamental y los armónicos caen rápido, más aún en el registro medio.
 */
const CORNET_AMPS: Record<'grave' | 'medio' | 'agudo', number[]> = {
  grave: [0, 1, 0.58, 0.3, 0.18, 0.12, 0.09, 0.05, 0.03, 0.03, 0.015, 0.01],
  medio: [0, 1, 0.3, 0.17, 0.08, 0.04, 0.025, 0.012, 0.008],
  agudo: [0, 1, 0.45, 0.14, 0.07, 0.035, 0.015, 0.008],
};
const cornetWaves = new Map<string, PeriodicWave>();
function cornetTone(c: AudioContext, freq: number): PeriodicWave {
  if (cornetWaveCtx !== c) { cornetWaves.clear(); cornetWaveCtx = c; }
  const reg = freq < 500 ? 'grave' : freq < 1100 ? 'medio' : 'agudo';
  let w = cornetWaves.get(reg);
  if (!w) {
    const amps = CORNET_AMPS[reg];
    w = c.createPeriodicWave(new Float32Array(amps.length), new Float32Array(amps), { disableNormalization: false });
    cornetWaves.set(reg, w);
  }
  return w;
}
let streetVerb: ConvolverNode | null = null;
let streetVerbCtx: AudioContext | null = null;
/** Eco corto de calle estrecha: reflexiones tempranas y una cola de algo más de un segundo. */
function street(c: AudioContext): ConvolverNode {
  if (streetVerb && streetVerbCtx === c) return streetVerb;
  const len = Math.floor(c.sampleRate * 1.5);
  const ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let seed = 1234 + ch * 77; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / c.sampleRate;
      lp += (rnd() - lp) * (0.55 - 0.3 * Math.min(1, t)); // la cola se va apagando en agudos
      d[i] = lp * Math.exp(-t * 4.6) * (t < 0.012 ? t / 0.012 : 1);
    }
    for (const [ms, g] of [[23, 0.5], [41, 0.38], [67, 0.3], [97, 0.2]] as const) d[Math.floor((ms + ch * 3) / 1000 * c.sampleRate)] += g * (ch ? -1 : 1);
  }
  const v = c.createConvolver(); v.buffer = ir;
  const wet = c.createGain(); wet.gain.value = 0.22;
  v.connect(wet); wet.connect(output(c));
  streetVerbCtx = c;
  return (streetVerb = v);
}

// ===== Corneta real: notas grabadas de una corneta de llaves (cedidas con permiso) =====
interface CornetSample { start: number; dur: number; f0: number }
let cornetBuf: AudioBuffer | null = null;
let cornetNotes: CornetSample[] = [];
let cornetLoading: Promise<boolean> | null = null;
/** Descarga y prepara las notas grabadas (una sola vez; se puede llamar antes del primer toque). */
export function loadCornetSamples(): Promise<boolean> {
  if (cornetLoading) return cornetLoading;
  cornetLoading = (async () => {
    const [meta, data] = await Promise.all([
      fetch('/sounds/corneta.json').then((r) => { if (!r.ok) throw new Error('sin notas'); return r.json(); }),
      fetch('/sounds/corneta.mp3').then((r) => { if (!r.ok) throw new Error('sin audio'); return r.arrayBuffer(); }),
    ]);
    // se decodifica fuera del contexto principal: no hace falta que el usuario haya tocado nada todavía
    const dec = new OfflineAudioContext(1, 1, 44100);
    cornetBuf = await new Promise<AudioBuffer>((res, rej) => dec.decodeAudioData(data, res, rej));
    cornetNotes = meta.notes;
    return true;
  })().catch((e) => { console.warn('[audio] notas de corneta no disponibles', e); cornetLoading = null; return false; });
  return cornetLoading;
}
export const cornetSamplesReady = () => !!cornetBuf;

/** Toca la nota con la grabación más cercana, afinada a la altura exacta. Devuelve false si aún no hay grabaciones. */
function cornetaReal(c: AudioContext, dest: AudioNode, freq: number, t: number, dur: number, vel: number): boolean {
  if (!cornetBuf || !cornetNotes.length) return false;
  let best = cornetNotes[0];
  for (const n of cornetNotes) if (Math.abs(Math.log(freq / n.f0)) < Math.abs(Math.log(freq / best.f0))) best = n;
  const rate = freq / best.f0;
  const end = t + dur;
  const src = c.createBufferSource();
  src.buffer = cornetBuf;
  src.playbackRate.value = rate;
  // notas más largas que la grabación: se repite la parte central, ya estable
  if (dur * rate > best.dur - 0.2) { src.loop = true; src.loopStart = best.start + 0.8; src.loopEnd = best.start + best.dur - 0.2; }
  const g = c.createGain();
  const peak = 0.6 * vel, a = 0.012, rel = Math.min(0.09, dur * 0.3);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, Math.max(t + a, end - rel)); g.gain.linearRampToValueAtTime(0.0001, end);
  const wet = c.createGain(); wet.gain.value = 0.35; // la grabación ya trae su sala: solo un poco de eco
  src.connect(g); g.connect(dest); g.connect(wet); wet.connect(street(c));
  src.start(t, best.start); src.stop(end + 0.05);
  return true;
}

function corneta(c: AudioContext, dest: AudioNode, freq: number, t: number, dur: number, vel = 0.8) {
  const end = t + dur;
  if (cornetaReal(c, dest, freq, t, dur, vel)) return;
  const o = c.createOscillator(); o.setPeriodicWave(cornetTone(c, freq));
  // ataque de lengua: la nota entra un poco baja y sube en seguida
  o.frequency.setValueAtTime(freq * 0.972, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.045);
  // vibrato: aparece en las notas largas y se ensancha
  if (dur > 0.42) {
    const lfo = c.createOscillator(); lfo.frequency.value = 5.4;
    const depth = c.createGain(); depth.gain.setValueAtTime(0, t + 0.2); depth.gain.linearRampToValueAtTime(freq * 0.0085, Math.min(end, t + 0.6));
    lfo.connect(depth); depth.connect(o.frequency); lfo.start(t); lfo.stop(end + 0.1);
  }
  // el brillo sigue a la fuerza: se abre en el ataque y se recoge al sostener
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.9;
  const top = Math.min(9000, freq * (4 + 5 * vel));
  lp.frequency.setValueAtTime(freq * 2, t); lp.frequency.exponentialRampToValueAtTime(top, t + 0.03); lp.frequency.exponentialRampToValueAtTime(Math.max(freq * 3, top * 0.62), t + Math.min(dur, 0.22));
  // formantes de la campana: el «canto» nasal y el filo
  const f1 = c.createBiquadFilter(); f1.type = 'peaking'; f1.frequency.value = 1250; f1.Q.value = 1.1; f1.gain.value = 3;
  const f2 = c.createBiquadFilter(); f2.type = 'peaking'; f2.frequency.value = 2700; f2.Q.value = 1.4; f2.gain.value = 1.5;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = Math.min(260, freq * 0.6);
  const g = c.createGain();
  const peak = 0.26 * vel, a = 0.016, rel = Math.min(0.08, dur * 0.3);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak * 1.18, t + a); g.gain.exponentialRampToValueAtTime(peak * 0.86, t + Math.min(dur * 0.5, 0.11));
  g.gain.setValueAtTime(peak * 0.86, Math.max(t + a, end - rel)); g.gain.linearRampToValueAtTime(0.0001, end);
  o.connect(lp); lp.connect(f1); f1.connect(f2); f2.connect(hp); hp.connect(g); g.connect(dest); g.connect(street(c));
  o.start(t); o.stop(end + 0.05);
  // golpe de aire del picado
  const n = c.createBufferSource(); const nb = c.createBuffer(1, Math.floor(c.sampleRate * 0.03), c.sampleRate);
  const nd = nb.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
  n.buffer = nb;
  const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = Math.min(4200, freq * 3.2); nf.Q.value = 1.2;
  const ng = c.createGain(); ng.gain.value = 0.07 * vel;
  n.connect(nf); nf.connect(ng); ng.connect(dest); n.start(t);
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
  loadCornetSamples(); // por si aún no se habían pedido (las primeras notas pueden salir sintetizadas)
  const master = c.createGain(); master.gain.value = 1; master.connect(output(c));
  const doc0 = parts[0].doc;
  const beatsPerMeasure = doc0.time[0];
  const beatQuarters = 4 / doc0.time[1];
  const secPerQuarter = 60 / opts.tempo / beatQuarters;
  type Ev = { t: number; dur: number; midi: number | null; perc: boolean; gain: number; id: string; cornet: boolean };
  const measureStarts: { n: number; t: number }[] = [];
  const evs: Ev[] = [];
  let lenSec = 0;
  for (const p of parts) {
    let t = 0;
    let tied: Ev | null = null;
    // con la obra entera se respetan las repeticiones; con un fragmento se toca tal cual
    const range = p.doc.measures.filter((m) => m.n >= opts.from && m.n <= opts.to);
    const seq = range.length === p.doc.measures.length ? playOrder(range) : range;
    for (const m of seq) {
      if (p === parts[0]) measureStarts.push({ n: m.n, t });
      const cap = (p.doc.time[0] * 4) / p.doc.time[1];
      let mt = 0;
      for (const n of m.notes) {
        const q = noteQuarters(n);
        const midi = n.rest || !n.step ? null : midiOf(n.step, n.octave!, n.alter ?? 0) + p.doc.transposition;
        // nota ligada a la anterior de la misma altura: se prolonga, no se vuelve a atacar
        if (tied && midi != null && tied.midi === midi) tied.dur += q * secPerQuarter;
        else evs.push(tied = { t: t + mt * secPerQuarter, dur: q * secPerQuarter, midi, perc: !!p.perc || p.doc.clef === 'percussion', gain: p.gain, id: n.id, cornet: p.doc.clef === 'treble' });
        if (!n.tie || midi == null) tied = null;
        mt += q;
      }
      // compases incompletos (anacrusa, cambios de compás) duran lo que suman sus figuras
      t += (mt > 0 ? mt : cap) * secPerQuarter;
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
      else if (e.midi != null && e.gain > 0) (e.cornet ? corneta : brass)(c, master, midiToFreq(e.midi), base + e.t, Math.max(0.05, e.dur * 0.92), e.gain);
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
