import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Send, ShieldCheck, AlertTriangle, Music } from '../components/icons';
import { get, post } from '../lib/api';
import { useLoad, Notice } from '../components/ui';
import { NoteQuiz } from '../components/Exercises';

type Msg = { role: 'user' | 'assistant'; content: string; verified?: boolean; mode?: string; sources?: string[]; action?: any };
const SUGGESTIONS = [
  '¿Qué notas aparecen en los compases 13 a 16?', 'Explícame el ritmo del compás 7', 'Hazme una rutina de 15 minutos',
  'Prepárame ejercicios con las notas que más fallo', '¿Cómo reconozco las notas sin tener que contarlas?', '¿Qué color tienen las notas de los compases 1 a 2?',
];

export default function Assistant() {
  const status = useLoad(() => get('/assistant/status'), []);
  const lib = useLoad(() => get<any[]>('/library/marchas'), []);
  const [marchaId, setMarchaId] = useState('');
  const [scoreId, setScoreId] = useState('');
  const det = useLoad(() => (marchaId ? get(`/library/marchas/${marchaId}`) : Promise.resolve(null)), [marchaId]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);
  const ask = async (q: string) => {
    if (!q.trim()) return;
    const history = msgs.slice(-8).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: 'user', content: q }]); setText(''); setBusy(true);
    try {
      const r = await post('/assistant', { message: q, marchaId: marchaId || null, scoreId: scoreId || null, history });
      setMsgs((m) => [...m, { role: 'assistant', content: r.answer, verified: r.verified, mode: r.mode, sources: r.sources, action: r.action }]);
    } catch (e) { setMsgs((m) => [...m, { role: 'assistant', content: (e as Error).message }]); } finally { setBusy(false); }
  };
  return (
    <div className="page stack" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div><div className="eyebrow">Ayuda para estudiar</div><h1>Asistente musical</h1></div>
        <span className={`badge ${status.data?.ai ? 'ok' : ''}`}>{status.data?.ai ? 'IA activada' : 'Modo verificable (sin IA)'}</span>
      </div>
      <Notice kind="info">Responde con los materiales autorizados de la banda y los datos de las partituras editables. Si algo no se puede verificar, te lo dirá: para dudas concretas de una partitura usa «Tengo una duda».</Notice>
      <div className="row"><Music size={16} /><select className="input" style={{ width: 'auto', minWidth: 280 }} value={marchaId} onChange={(e) => { setMarchaId(e.target.value); setScoreId(''); }} data-testid="assistant-marcha"><option value="">Sin marcha (preguntas generales)</option>{(lib.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
        {det.data && <select className="input" style={{ width: 'auto' }} value={scoreId} onChange={(e) => setScoreId(e.target.value)}><option value="">Mi parte</option>{det.data.scores.filter((x: any) => x.published_version_id).map((x: any) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>}</div>
      <div className="card stack" style={{ minHeight: 320 }}>
        {!msgs.length && <div className="stack sm"><span className="small muted">Prueba con:</span><div className="chips">{SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}</div></div>}
        {msgs.map((m, i) => (
          <div key={i} className="row nowrap" style={{ alignItems: 'flex-start', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            {m.role === 'assistant' && <div className="avatar"><Bot size={18} /></div>}
            <div className="card flat tight stack sm" style={{ maxWidth: '85%', background: m.role === 'user' ? 'color-mix(in srgb, var(--accent) 16%, var(--surface))' : 'var(--surface-2)' }}>
              <p className="pre">{m.content}</p>
              {m.role === 'assistant' && m.mode && <div className="row xs faint" style={{ gap: 6 }}>{m.verified ? <span className="badge ok"><ShieldCheck size={11} /> Verificado con los datos</span> : <span className="badge warn"><AlertTriangle size={11} /> Explicación general / no verificable</span>}{m.sources?.length ? <span>Fuentes: {m.sources.join(' · ')}</span> : null}</div>}
              {m.action?.type === 'trainer' && <div className="card flat tight"><NoteQuiz notes={m.action.notes} rounds={10} /></div>}
            </div>
          </div>
        ))}
        {busy && <div className="row"><div className="spinner" /><span className="small muted">Pensando…</span></div>}
        <div ref={end} />
      </div>
      <form className="row nowrap" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe tu pregunta…" />
        <button className="btn primary" disabled={busy || !text.trim()}><Send size={16} /></button>
      </form>
      <p className="xs faint">Para practicar sin conexión, usa la <Link to="/academia/entrenamiento">Academia</Link>.</p>
    </div>
  );
}
