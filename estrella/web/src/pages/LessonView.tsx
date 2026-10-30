import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Volume2, Check, Pencil, Save, Bot, Timer } from '../components/icons';
import { get, put, post } from '../lib/api';
import { useLoad, Spinner, ErrorBox, Notice, Field, useToast } from '../components/ui';
import { MiniStaff, NoteQuiz, IntervalQuiz, RhythmTap, TempoTap, parseNote } from '../components/Exercises';
import StaffView, { ColorLegend } from '../components/StaffView';
import { playMidiSequence, playRhythm, startMetronome } from '../lib/audio';
import { midiOf, uid, DUR_ES, type Dur } from '../../../shared/music';
import { docOf } from '../components/Exercises';

const STEPS = ['Explicación', 'Demostración', 'Ejemplo auditivo', 'Ejercicio', 'Test', 'En una marcha', 'Resumen'];

export default function LessonView() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const l = useLoad(() => get(`/academy/lessons/${id}`), [id]);
  const [edit, setEdit] = useState(sp.get('editar') === '1');
  if (l.error) return <div className="page"><ErrorBox error={l.error} /></div>;
  if (!l.data) return <Spinner />;
  return edit && l.data.can_edit ? <LessonEditor lesson={l.data} onDone={() => { setEdit(false); l.reload(); }} /> : <LessonPlayer key={id} lesson={l.data} onEdit={() => setEdit(true)} />;
}

function LessonPlayer({ lesson: x, onEdit }: { lesson: any; onEdit: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [started] = useState(Date.now());
  const quiz: any[] = x.quiz ?? [];
  const score = quiz.length ? Math.round((quiz.filter((q, i) => answers[i] === q.answer).length / quiz.length) * 100) : 100;
  const available = STEPS.map((_, i) => (i === 1 ? !!x.demo : i === 2 ? !!x.audio : i === 3 ? !!x.exercise : i === 4 ? quiz.length > 0 : true));
  const next = () => { let n = step + 1; while (n < STEPS.length && !available[n]) n++; setStep(Math.min(n, STEPS.length - 1)); };
  const prev = () => { let n = step - 1; while (n > 0 && !available[n]) n--; setStep(Math.max(0, n)); };
  const finish = async () => {
    try {
      await post(`/academy/lessons/${x.id}/progress`, { completed: true, quiz_score: quiz.length ? score : null, minutes: Math.max(1, Math.round((Date.now() - started) / 60000)) });
      toast({ kind: 'ok', text: 'Lección completada' });
      if (x.next) nav(`/academia/leccion/${x.next.id}`); else nav(`/academia/curso/${x.course_id}`);
    } catch (e) { toast({ kind: 'error', text: (e as Error).message }); }
  };
  return (
    <div className="page stack lg" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div><div className="eyebrow"><Link to={`/academia/curso/${x.course_id}`}>{x.course_title}</Link></div><h1>{x.title}</h1></div>
        {x.can_edit && <button className="btn" onClick={onEdit}><Pencil size={16} /> Editar</button>}
      </div>
      {x.status !== 'publicado' && <Notice kind="warn" title={`Contenido ${x.status === 'revision' ? 'en revisión' : 'en borrador'}`}>Solo lo ven la dirección y los responsables hasta su publicación.</Notice>}
      <div className="row" style={{ gap: 4 }}>{STEPS.map((s, i) => <button key={s} disabled={!available[i]} className={`chip ${i === step ? 'on' : ''}`} onClick={() => setStep(i)} style={{ opacity: available[i] ? 1 : .35 }}>{i + 1}. {s}</button>)}</div>
      <div className="card stack" style={{ minHeight: 260 }}>
        <h2>{STEPS[step]}</h2>
        {step === 0 && <p className="pre" style={{ fontSize: '1.05rem', lineHeight: 1.65 }}>{x.explanation}</p>}
        {step === 1 && x.demo && <Demo demo={x.demo} />}
        {step === 2 && x.audio && <AudioDemo audio={x.audio} />}
        {step === 3 && x.exercise && <Exercise ex={x.exercise} />}
        {step === 4 && (
          <div className="stack">
            {quiz.map((q, i) => (
              <div key={i} className="stack sm">
                <strong>{i + 1}. {q.q}</strong>
                {q.options.map((o: string, j: number) => {
                  const chosen = answers[i] === j; const shown = answers[i] != null;
                  return <button key={j} className={`btn quiz-opt ${shown && j === q.answer ? 'right' : ''} ${chosen && j !== q.answer ? 'wrong' : ''}`} onClick={() => answers[i] == null && setAnswers({ ...answers, [i]: j })}>{o}</button>;
                })}
                {answers[i] != null && q.explain && <span className="small muted">{q.explain}</span>}
              </div>
            ))}
            {Object.keys(answers).length === quiz.length && <Notice kind={score >= 60 ? 'ok' : 'warn'} title={`Resultado: ${score}%`}>{score >= 60 ? '¡Bien!' : 'Repasa la explicación y vuelve a intentarlo.'}</Notice>}
          </div>
        )}
        {step === 5 && <div className="stack"><p className="pre" style={{ fontSize: '1.05rem' }}>{x.practice || 'Aplica lo aprendido en tu parte de la próxima marcha del calendario.'}</p><Link className="btn" to="/biblioteca">Ir a la biblioteca</Link></div>}
        {step === 6 && <div className="stack"><div className="notice ok"><Check /><p className="pre">{x.summary}</p></div><button className="btn primary lg" onClick={finish}>Completar lección{x.next ? ' y seguir' : ''}</button></div>}
      </div>
      <div className="row between">
        <button className="btn" disabled={step === 0} onClick={prev}><ChevronLeft size={16} /> Anterior</button>
        {step < STEPS.length - 1 && <button className="btn primary" onClick={next}>Siguiente <ChevronRight size={16} /></button>}
      </div>
    </div>
  );
}

function Demo({ demo }: { demo: any }) {
  if (demo.type === 'staff') return <div className="stack"><MiniStaff notes={demo.notes} labels={demo.labels} colorMode={demo.colorMode} />{demo.colorMode && <ColorLegend />}<p className="small muted">Toca el nombre de una nota para oírla.</p></div>;
  if (demo.type === 'rhythm') {
    const figs: string[] = demo.figures;
    const doc = docOf(figs.map((f) => ({ id: uid(), step: 'B', octave: 4, alter: 0, dur: f.replace('.', '') as Dur, dots: f.endsWith('.') ? 1 : 0 })), 'treble', [figs.length, 4]);
    return <div className="stack"><div className="staff-paper"><StaffView doc={doc} compact /></div><div className="row">{figs.map((f, i) => <span key={i} className="badge">{DUR_ES[f.replace('.', '') as Dur]}{f.endsWith('.') ? ' con puntillo' : ''}</span>)}</div></div>;
  }
  if (demo.type === 'meter') return <div className="grid cols-4">{demo.meters.map((m: string) => <div key={m} className="card flat stack" style={{ alignItems: 'center' }}><span style={{ fontFamily: 'var(--font-display)', fontSize: '2.4rem', fontWeight: 700 }}>{m}</span><span className="small muted">{m === '6/8' ? '2 pulsos de 3 corcheas' : `${m.split('/')[0]} pulsos por compás`}</span></div>)}</div>;
  if (demo.type === 'checklist') return <ol className="stack sm" style={{ paddingLeft: 20 }}>{['Clave', 'Armadura', 'Compás y tempo', 'Repeticiones y saltos', 'Pasajes difíciles', 'Ritmo'].map((s) => <li key={s}>{s}</li>)}</ol>;
  return null;
}

function AudioDemo({ audio }: { audio: any }) {
  const [metro, setMetro] = useState<null | (() => void)>(null);
  if (audio.notes) return <div className="stack"><MiniStaff notes={audio.notes} /><button className="btn primary" onClick={() => playMidiSequence(audio.notes.map((n: string) => { const p = parseNote(n); return midiOf(p.step!, p.octave!, p.alter); }), audio.tempo ?? 80)}><Volume2 size={18} /> Escuchar</button><p className="xs faint">Sonido sintético de referencia.</p></div>;
  if (audio.rhythm) return <button className="btn primary" onClick={() => playRhythm(audio.rhythm, audio.tempo ?? 80)}><Volume2 size={18} /> Escuchar el ritmo</button>;
  if (audio.metronome) return <button className={`btn ${metro ? 'on' : 'primary'}`} onClick={() => { if (metro) { metro(); setMetro(null); } else setMetro(() => startMetronome(audio.tempo ?? 80, 4)); }}><Timer size={18} /> {metro ? 'Detener' : `Metrónomo a ${audio.tempo}`}</button>;
  return null;
}

function Exercise({ ex }: { ex: any }) {
  if (ex.type === 'identify') return <NoteQuiz notes={ex.notes} rounds={ex.rounds ?? 10} timed={ex.timed} clef={ex.clef ?? 'treble'} />;
  if (ex.type === 'line-space') return <NoteQuiz notes={ex.notes} rounds={ex.rounds ?? 10} mode="line-space" />;
  if (ex.type === 'interval') return <IntervalQuiz intervals={ex.intervals} rounds={ex.rounds ?? 10} />;
  if (ex.type === 'rhythm-tap') return <RhythmTap pattern={ex.pattern} tempo={ex.tempo} />;
  if (ex.type === 'tempo-tap') return <TempoTap tempo={ex.tempo} beats={ex.beats} />;
  return null;
}

function LessonEditor({ lesson, onDone }: { lesson: any; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ ...lesson, demo: lesson.demo ? JSON.stringify(lesson.demo) : '', audio: lesson.audio ? JSON.stringify(lesson.audio) : '', exercise: lesson.exercise ? JSON.stringify(lesson.exercise) : '', quiz: JSON.stringify(lesson.quiz ?? [], null, 1) });
  const [busy, setBusy] = useState(false);
  const save = async (status?: string) => {
    try {
      const j = (s: string) => (s.trim() ? JSON.parse(s) : null);
      await put(`/academy/lessons/${lesson.id}`, { course_id: f.course_id, sort: f.sort, title: f.title, explanation: f.explanation, demo: j(f.demo), audio: j(f.audio), exercise: j(f.exercise), quiz: j(f.quiz) ?? [], practice: f.practice, summary: f.summary, status: status ?? f.status });
      toast({ kind: 'ok', text: 'Lección guardada' }); onDone();
    } catch (e) { toast({ kind: 'error', text: e instanceof SyntaxError ? 'Hay un error de formato en los campos JSON.' : (e as Error).message }); }
  };
  const suggest = async () => {
    setBusy(true);
    try { const r = await post(`/assistant/lesson-quiz/${lesson.id}`); setF({ ...f, quiz: JSON.stringify(r.quiz, null, 1) }); toast({ kind: 'info', text: r.note }); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="page stack" style={{ maxWidth: 900 }}>
      <div className="page-head"><div><div className="eyebrow">Editar lección · estado: {f.status}</div><h1>{f.title}</h1></div>
        <div className="row"><button className="btn" onClick={onDone}>Cancelar</button><button className="btn" onClick={() => save()}><Save size={16} /> Guardar</button>{lesson.can_publish ? <button className="btn primary" onClick={() => save('publicado')}>Publicar</button> : <button className="btn primary" onClick={() => save('revision')}>Enviar a revisión</button>}</div></div>
      <Field label="Título"><input className="input" value={f.title} onChange={set('title')} /></Field>
      <Field label="1. Explicación sencilla"><textarea className="input" style={{ minHeight: 180 }} value={f.explanation} onChange={set('explanation')} /></Field>
      <Field label="2. Demostración visual (JSON)" hint='{"type":"staff","notes":["E4","G4"],"labels":true,"colorMode":true}'><textarea className="input mono" value={f.demo} onChange={set('demo')} /></Field>
      <Field label="3. Ejemplo auditivo (JSON)" hint='{"notes":["C4","E4","G4"],"tempo":80}'><textarea className="input mono" value={f.audio} onChange={set('audio')} /></Field>
      <Field label="4. Ejercicio interactivo (JSON)" hint='{"type":"identify","notes":["E4","G4","B4"],"rounds":10} · tipos: identify, line-space, interval, rhythm-tap, tempo-tap'><textarea className="input mono" value={f.exercise} onChange={set('exercise')} /></Field>
      <Field label="5. Test (JSON: [{q, options, answer, explain}])"><textarea className="input mono" style={{ minHeight: 160 }} value={f.quiz} onChange={set('quiz')} /></Field>
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={suggest} disabled={busy}><Bot size={15} /> Proponer test con el asistente (revisar antes de guardar)</button>
      <Field label="6. Aplicación práctica en una marcha"><textarea className="input" value={f.practice ?? ''} onChange={set('practice')} /></Field>
      <Field label="7. Resumen para repasar"><textarea className="input" value={f.summary ?? ''} onChange={set('summary')} /></Field>
    </div>
  );
}
