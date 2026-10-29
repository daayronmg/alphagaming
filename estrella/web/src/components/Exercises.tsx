import { useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, Check, X, RotateCcw, Play, Hand } from './icons';
import StaffView from './StaffView';
import { post } from '../lib/api';
import { playTone, playMidiSequence, playRhythm, audioCtx } from '../lib/audio';
import { uid, midiOf, noteName, staffPosition, placement, noteQuarters, STEP_ES, type ScoreDoc, type Note, type Step, type Dur } from '../../../shared/music';

export function parseNote(s: string): Note {
  const m = s.match(/^([A-G])(#|b)?(\d)$/);
  if (!m) return { id: uid(), rest: true, dur: 'q' };
  return { id: uid(), step: m[1] as Step, alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave: Number(m[3]), dur: 'q' };
}
export function docOf(notes: Note[], clef: 'treble' | 'bass' = 'treble', time: [number, number] = [4, 4]): ScoreDoc {
  return { schema: 1, title: '', clef, key: 0, time, tempo: 80, transposition: 0, measures: [{ id: 'm1', n: 1, notes }] };
}

export function MiniStaff({ notes, clef = 'treble', colorMode, labels }: { notes: string[]; clef?: 'treble' | 'bass'; colorMode?: boolean; labels?: boolean }) {
  const ns = useMemo(() => notes.map(parseNote), [notes.join(',')]); // eslint-disable-line
  const doc = useMemo(() => docOf(ns, clef, [Math.max(1, ns.length), 4]), [ns, clef]);
  return (
    <div className="stack sm">
      <div className="staff-paper"><StaffView doc={doc} colorMode={colorMode} compact /></div>
      {labels && <div className="row" style={{ gap: 6, justifyContent: 'center' }}>{ns.map((n) => <button key={n.id} className="chip" onClick={() => playTone(midiOf(n.step!, n.octave!, n.alter))}>{noteName(n)}</button>)}</div>}
    </div>
  );
}

async function record(exercise: string, item: string, correct: boolean, ms?: number) {
  try { await post('/academy/exercise-results', [{ exercise, item, correct, ms }]); } catch { /* sin conexión: no bloquea */ }
}

const NAMES: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** Identificar notas en el pentagrama (lectura). mode 'line-space': decir si está en línea o fuera. */
export function NoteQuiz({ notes, rounds = 10, mode = 'name', timed, onFinish, clef = 'treble', ear }: { notes: string[]; rounds?: number; mode?: 'name' | 'line-space'; timed?: boolean; onFinish?: (score: number) => void; clef?: 'treble' | 'bass'; ear?: boolean }) {
  const pickNext = (prev?: string) => { let n; do { n = notes[Math.floor(Math.random() * notes.length)]; } while (notes.length > 1 && n === prev); return n; };
  const [cur, setCur] = useState(() => pickNext());
  const [i, setI] = useState(0);
  const [ok, setOk] = useState(0);
  const [fb, setFb] = useState<null | { right: boolean; answer: string }>(null);
  const t0 = useRef(performance.now());
  const note = useMemo(() => parseNote(cur), [cur]);
  const done = i >= rounds;
  useEffect(() => { t0.current = performance.now(); if (ear) setTimeout(() => playTone(midiOf(note.step!, note.octave!, note.alter)), 200); }, [cur]); // eslint-disable-line
  useEffect(() => { if (done) onFinish?.(Math.round((ok / rounds) * 100)); }, [done]); // eslint-disable-line

  const answer = (a: string) => {
    if (fb) return;
    const pos = staffPosition(note.step!, note.octave!, clef);
    const right = mode === 'name' ? a === note.step : a === placement(pos);
    const correctLabel = mode === 'name' ? STEP_ES[note.step!] : placement(pos) === 'linea' ? 'Sobre una línea' : 'Fuera de las líneas';
    const ms = Math.round(performance.now() - t0.current);
    record(ear ? 'oido' : 'lectura', cur, right, ms);
    setFb({ right, answer: correctLabel });
    if (right) setOk((x) => x + 1);
    if (!ear) playTone(midiOf(note.step!, note.octave!, note.alter), 0.5);
    setTimeout(() => { setFb(null); setI((x) => x + 1); setCur((c) => pickNext(c)); }, right ? 650 : 1500);
  };
  if (done) return (
    <div className="card flat stack" style={{ alignItems: 'center' }} data-testid="quiz-done">
      <div className="stat"><span className="v">{ok}/{rounds}</span><span className="l">aciertos</span></div>
      <button className="btn" onClick={() => { setI(0); setOk(0); setCur(pickNext()); }}><RotateCcw size={16} /> Repetir</button>
    </div>
  );
  return (
    <div className="stack" data-testid="note-quiz">
      <div className="row between"><span className="small muted">{i + 1} / {rounds}</span><span className="small">Aciertos: {ok}</span></div>
      {ear ? <div className="card flat row" style={{ justifyContent: 'center', padding: 30 }}><button className="btn lg primary" onClick={() => playTone(midiOf(note.step!, note.octave!, note.alter))}><Volume2 size={20} /> Escuchar otra vez</button></div>
        : <MiniStaff notes={[cur]} clef={clef} />}
      {ear && <p className="xs muted" style={{ textAlign: 'center' }}>Referencia: <button className="btn sm" onClick={() => playTone(72)}>Do</button> (el sonido es sintético).</p>}
      <div className="grid" style={{ gridTemplateColumns: mode === 'name' ? 'repeat(7, 1fr)' : '1fr 1fr', gap: 8 }}>
        {mode === 'name' ? NAMES.map((n) => <button key={n} className="btn lg" onClick={() => answer(n)} data-testid={`answer-${n}`}>{STEP_ES[n]}</button>)
          : [['linea', 'Sobre una línea'], ['fuera', 'Fuera de las líneas']].map(([v, l]) => <button key={v} className="btn lg" onClick={() => answer(v)}>{l}</button>)}
      </div>
      {fb && <div className={`notice ${fb.right ? 'ok' : 'danger'}`}>{fb.right ? <Check size={18} /> : <X size={18} />}<span>{fb.right ? '¡Correcto!' : `Era: ${fb.answer}`}{timed && fb.right ? ` · ${Math.round(performance.now() - t0.current)} ms` : ''}</span></div>}
    </div>
  );
}

const INTERVAL_NAMES: Record<number, string> = { 2: '2ª', 3: '3ª', 4: '4ª', 5: '5ª', 6: '6ª', 7: '7ª', 8: '8ª' };
const STEPS_ALL = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5'];
export function IntervalQuiz({ intervals = [2, 3, 4, 5, 8], rounds = 10, onFinish }: { intervals?: number[]; rounds?: number; onFinish?: (s: number) => void }) {
  const gen = () => { const iv = intervals[Math.floor(Math.random() * intervals.length)]; const base = Math.floor(Math.random() * (STEPS_ALL.length - iv)); return { iv, notes: [STEPS_ALL[base], STEPS_ALL[base + iv - 1]] }; };
  const [q, setQ] = useState(gen);
  const [i, setI] = useState(0); const [ok, setOk] = useState(0); const [fb, setFb] = useState<string | null>(null);
  useEffect(() => { if (i >= rounds) onFinish?.(Math.round(ok / rounds * 100)); }, [i]); // eslint-disable-line
  if (i >= rounds) return <div className="card flat stack" style={{ alignItems: 'center' }}><div className="stat"><span className="v">{ok}/{rounds}</span><span className="l">aciertos</span></div><button className="btn" onClick={() => { setI(0); setOk(0); setQ(gen()); }}><RotateCcw size={16} /> Repetir</button></div>;
  const play = () => playMidiSequence(q.notes.map((n) => { const p = parseNote(n); return midiOf(p.step!, p.octave!, 0); }), 70);
  return (
    <div className="stack">
      <div className="row between"><span className="small muted">{i + 1}/{rounds}</span><button className="btn sm" onClick={play}><Volume2 size={14} /> Escuchar</button></div>
      <MiniStaff notes={q.notes} />
      <div className="row">{intervals.map((iv) => <button key={iv} className="btn lg" onClick={() => {
        if (fb) return;
        const right = iv === q.iv; record('intervalos', INTERVAL_NAMES[q.iv], right);
        if (right) setOk(ok + 1); setFb(right ? '¡Correcto!' : `Era una ${INTERVAL_NAMES[q.iv]}`); play();
        setTimeout(() => { setFb(null); setI(i + 1); setQ(gen()); }, 1300);
      }}>{INTERVAL_NAMES[iv]}</button>)}</div>
      {fb && <div className={`notice ${fb.startsWith('¡') ? 'ok' : 'danger'}`}>{fb}</div>}
    </div>
  );
}

/** Ritmo: se escucha el patrón y se toca (botón o barra espaciadora). Se comparan los ataques con los esperados. */
export function RhythmTap({ pattern, tempo = 70 }: { pattern: string[]; tempo?: number }) {
  const durs = pattern.map((p) => ({ dur: p.replace('.', '') as Dur, dots: p.endsWith('.') ? 1 : 0 }));
  const beat = 60 / tempo;
  const expected = durs.reduce<number[]>((a, d, i) => { a.push(i === 0 ? 0 : a[i - 1] + noteQuarters(durs[i - 1]) * beat); return a; }, []);
  const [taps, setTaps] = useState<number[]>([]);
  const [state, setState] = useState<'idle' | 'count' | 'tap' | 'done'>('idle');
  const start = useRef(0);
  const doc = useMemo(() => docOf(durs.map((d) => ({ id: uid(), step: 'B', octave: 4, alter: 0, dur: d.dur, dots: d.dots })), 'treble', [Math.max(1, Math.round(durs.reduce((a, d) => a + noteQuarters(d), 0))), 4]), [pattern.join()]); // eslint-disable-line
  const go = () => {
    const c = audioCtx();
    setTaps([]); setState('count');
    // 4 clics de cuenta y luego se toca
    for (let k = 0; k < 4; k++) { const o = c.createOscillator(); const g = c.createGain(); o.frequency.value = k === 0 ? 1600 : 1100; g.gain.setValueAtTime(0.3, c.currentTime + k * beat); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + k * beat + 0.05); o.connect(g); g.connect(c.destination); o.start(c.currentTime + k * beat); o.stop(c.currentTime + k * beat + 0.06); }
    start.current = performance.now() + 4 * beat * 1000;
    setTimeout(() => setState('tap'), 3 * beat * 1000);
    setTimeout(() => setState('done'), (4 * beat + expected[expected.length - 1] + 2 * beat) * 1000);
  };
  const tap = () => { if (state === 'tap' || state === 'count') setTaps((t) => [...t, (performance.now() - start.current) / 1000]); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); tap(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  const analysis = state === 'done' ? expected.map((t, i) => {
    const near = taps.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), Infinity);
    const diff = Math.round((near - t) * 1000);
    return { i, diff: isFinite(diff) ? diff : null };
  }) : [];
  useEffect(() => { if (state === 'done') { const good = analysis.filter((a) => a.diff != null && Math.abs(a.diff) <= 120).length; record('ritmo', pattern.join(' '), good === expected.length); } }, [state]); // eslint-disable-line
  return (
    <div className="stack">
      <div className="staff-paper"><StaffView doc={doc} compact /></div>
      <div className="row">
        <button className="btn" onClick={() => playRhythm(durs.map((d) => [d.dur, !!d.dots]), tempo)}><Volume2 size={16} /> Escuchar</button>
        <button className="btn primary" onClick={go}><Play size={16} /> Empezar (4 de cuenta)</button>
        <button className="btn lg" onPointerDown={tap} disabled={state === 'idle' || state === 'done'} style={{ minWidth: 140 }}><Hand size={18} /> Tocar</button>
        <span className="xs faint">o barra espaciadora</span>
      </div>
      {state === 'done' && (
        <div className="card flat tight stack sm">
          {analysis.map((a) => <div key={a.i} className="row small"><span>Nota {a.i + 1}</span>{a.diff == null ? <span className="badge danger">no tocada</span> : Math.abs(a.diff) <= 120 ? <span className="badge ok">a tiempo ({a.diff > 0 ? '+' : ''}{a.diff} ms)</span> : <span className="badge warn">{a.diff > 0 ? 'tarde' : 'pronto'} ({a.diff > 0 ? '+' : ''}{a.diff} ms)</span>}</div>)}
          {taps.length > expected.length && <span className="small muted">Has tocado {taps.length - expected.length} golpes de más.</span>}
          <p className="xs faint">Detección aproximada: depende de la latencia de la pantalla y del audio del dispositivo (±50 ms).</p>
        </div>
      )}
    </div>
  );
}

/** Pulso: tocar a tempo y medir la desviación media (acelerar / retrasar). */
export function TempoTap({ tempo = 80, beats = 8 }: { tempo?: number; beats?: number }) {
  const [taps, setTaps] = useState<number[]>([]);
  const add = () => setTaps((t) => [...t, performance.now()].slice(-(beats + 1)));
  const intervals = taps.slice(1).map((t, i) => t - taps[i]);
  const avg = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
  const bpm = avg ? Math.round(60000 / avg) : 0;
  const drift = intervals.length > 3 ? Math.round((60000 / ((intervals.slice(-3).reduce((a, b) => a + b, 0)) / 3)) - (60000 / ((intervals.slice(0, 3).reduce((a, b) => a + b, 0)) / 3))) : 0;
  useEffect(() => { if (taps.length === beats + 1) record('ritmo', `pulso ${tempo}`, Math.abs(bpm - tempo) <= 4); }, [taps.length]); // eslint-disable-line
  return (
    <div className="stack">
      <p className="small muted">Toca {beats} veces al pulso de ♩={tempo}. Puedes escuchar el metrónomo antes.</p>
      <div className="row">
        <button className="btn" onClick={() => playMidiSequence(Array(4).fill(84), tempo)}><Volume2 size={16} /> Escuchar 4 pulsos</button>
        <button className="btn xl primary" onPointerDown={add} style={{ minWidth: 180 }}><Hand size={22} /> Tocar</button>
        <button className="btn" onClick={() => setTaps([])}><RotateCcw size={16} /></button>
      </div>
      {bpm > 0 && <div className="row"><span className="badge">Tu pulso medio: ♩={bpm}</span><span className={`badge ${Math.abs(bpm - tempo) <= 4 ? 'ok' : 'warn'}`}>{bpm > tempo + 4 ? 'Vas acelerado' : bpm < tempo - 4 ? 'Vas lento' : 'Buen pulso'}</span>{intervals.length > 3 && Math.abs(drift) > 4 && <span className="badge warn">{drift > 0 ? 'Aceleras' : 'Retrasas'} a lo largo ({drift > 0 ? '+' : ''}{drift} ppm)</span>}</div>}
    </div>
  );
}
