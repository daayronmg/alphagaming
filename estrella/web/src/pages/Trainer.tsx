import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get } from '../lib/api';
import { useLoad, Tabs, Notice } from '../components/ui';
import { NoteQuiz, IntervalQuiz, RhythmTap, TempoTap } from '../components/Exercises';

const SETS: Record<string, { label: string; notes: string[] }> = {
  pentagrama: { label: 'Dentro del pentagrama', notes: ['E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5'] },
  adicionales: { label: 'Líneas adicionales', notes: ['A3', 'B3', 'C4', 'D4', 'G5', 'A5', 'B5', 'C6'] },
  todo: { label: 'Todo el registro', notes: ['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6'] },
  clavefa: { label: 'Clave de fa', notes: ['G2', 'A2', 'B2', 'C3', 'D3', 'E3', 'F3', 'G3', 'A3'] },
};
const RHYTHMS = [['q', 'q', 'h'], ['q', '8', '8', 'q', 'q'], ['8.', '16', 'q', '8', '8', 'q'], ['8', '8', '8', '8', 'h'], ['q.', '8', 'q', 'q']];

export default function Trainer() {
  const [sp] = useSearchParams();
  const [mode, setMode] = useState<'lectura' | 'oido' | 'intervalos' | 'ritmo' | 'pulso'>((sp.get('modo') as any) || 'lectura');
  const [set, setSet] = useState<string>(sp.get('fallos') ? 'fallos' : 'pentagrama');
  const [timed, setTimed] = useState(false);
  const [rIdx, setRIdx] = useState(0);
  const [key, setKey] = useState(0);
  const stats = useLoad(() => get('/academy/me/stats'), []);
  const weak: string[] = (stats.data?.weak ?? []).filter((w: any) => w.exercise === 'lectura' && w.fails > 0).map((w: any) => w.item);
  const notes = set === 'fallos' ? weak : SETS[set]?.notes ?? SETS.pentagrama.notes;
  return (
    <div className="page stack lg" style={{ maxWidth: 860 }}>
      <div className="page-head"><div><div className="eyebrow">Academia</div><h1>Entrenamiento</h1></div></div>
      <Tabs value={mode} onChange={(m) => { setMode(m); setKey((k) => k + 1); }} items={[{ value: 'lectura', label: 'Lectura' }, { value: 'oido', label: 'Oído' }, { value: 'intervalos', label: 'Intervalos' }, { value: 'ritmo', label: 'Ritmo' }, { value: 'pulso', label: 'Pulso' }]} />
      {(mode === 'lectura' || mode === 'oido') && (
        <div className="row">
          <div className="chips">{Object.entries(SETS).map(([k, v]) => <button key={k} className={`chip ${set === k ? 'on' : ''}`} onClick={() => { setSet(k); setKey((x) => x + 1); }}>{v.label}</button>)}
            <button className={`chip ${set === 'fallos' ? 'on' : ''}`} disabled={!weak.length} onClick={() => { setSet('fallos'); setKey((x) => x + 1); }}>Mis fallos ({weak.length})</button></div>
          {mode === 'lectura' && <label className="checkbox"><input type="checkbox" checked={timed} onChange={(e) => setTimed(e.target.checked)} /> Cronometrado</label>}
        </div>
      )}
      <div className="card">
        {(mode === 'lectura' || mode === 'oido') && (notes.length ? <NoteQuiz key={`${mode}${set}${key}`} notes={notes} rounds={15} timed={timed} ear={mode === 'oido'} clef={set === 'clavefa' ? 'bass' : 'treble'} /> : <Notice kind="info">Aún no hay fallos registrados.</Notice>)}
        {mode === 'intervalos' && <IntervalQuiz key={key} />}
        {mode === 'ritmo' && <div className="stack"><div className="chips">{RHYTHMS.map((r, i) => <button key={i} className={`chip ${rIdx === i ? 'on' : ''}`} onClick={() => setRIdx(i)}>Ritmo {i + 1}</button>)}</div><RhythmTap key={rIdx} pattern={RHYTHMS[rIdx]} tempo={66} /></div>}
        {mode === 'pulso' && <TempoTap tempo={80} beats={12} />}
      </div>
      <p className="xs faint">Los resultados sirven para proponerte repasos. No miden cómo tocas en la banda.</p>
    </div>
  );
}
