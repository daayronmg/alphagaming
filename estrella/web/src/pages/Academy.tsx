import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, Flame, Target, Ear, Drum, Timer, Plus, ChevronRight } from '../components/icons';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Modal, Field, useToast, Spinner } from '../components/ui';

const LEVELS: Record<number, { t: string; d: string }> = {
  1: { t: 'Nivel 1 · Fundamentos', d: 'Desde cero: notas, pentagrama, claves, figuras, compás y tempo.' },
  2: { t: 'Nivel 2 · Lectura aplicada', d: 'Leer con rapidez, intervalos, patrones y primera vista.' },
  3: { t: 'Nivel 3 · Técnica aplicada a la banda', d: 'Tempo, entradas, coordinación y técnica por instrumento.' },
};

export default function Academy() {
  const { can, canSection } = useAuth();
  const courses = useLoad(() => get<any[]>('/academy/courses'), []);
  const stats = useLoad(() => get('/academy/me/stats'), []);
  const [creating, setCreating] = useState(false);
  const editor = can('academy.manage') || canSection('lessons');
  const st = stats.data;
  return (
    <div className="page stack lg">
      <div className="page-head">
        <div><div className="eyebrow">Aprender desde cero</div><h1>Academia</h1></div>
        {editor && <button className="btn primary" onClick={() => setCreating(true)}><Plus size={18} /> Nuevo curso</button>}
      </div>
      <div className="grid cols-4">
        <div className="card stat"><span className="v" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Flame color="var(--accent)" />{st?.streak ?? 0}</span><span className="l">días seguidos estudiando</span></div>
        <div className="card stat"><span className="v">{st?.lessons?.completed ?? 0}</span><span className="l">lecciones completadas</span></div>
        <div className="card stat"><span className="v">{st?.totals?.answers ?? 0}</span><span className="l">ejercicios respondidos</span></div>
        <div className="card stat"><span className="v">{st?.totals?.answers ? Math.round((st.totals.correct / st.totals.answers) * 100) : 0}%</span><span className="l">aciertos</span></div>
      </div>
      <div className="grid cols-4">
        <Link to="/academia/entrenamiento?modo=lectura" className="card hover stack sm"><Target /><h3>Lectura de notas</h3><p className="small muted">Reconoce notas con rapidez. Repite las que más fallas.</p></Link>
        <Link to="/academia/entrenamiento?modo=oido" className="card hover stack sm"><Ear /><h3>Entrenador de oído</h3><p className="small muted">Escucha y reconoce notas e intervalos.</p></Link>
        <Link to="/academia/entrenamiento?modo=ritmo" className="card hover stack sm"><Drum /><h3>Ritmo</h3><p className="small muted">Toca el ritmo y detecta adelantos y retrasos.</p></Link>
        <Link to="/academia/herramientas" className="card hover stack sm"><Timer /><h3>Afinador y metrónomo</h3><p className="small muted">Afinación con el micrófono, metrónomo y autograbación.</p></Link>
      </div>
      {st?.weak?.length > 0 && <div className="card"><h3>Para repasar</h3><p className="small muted" style={{ margin: '6px 0 10px' }}>Según tus resultados (no es una valoración de cómo tocas):</p><div className="chips">{st.weak.map((w: any) => <span key={w.exercise + w.item} className="chip">{w.item} · {w.fails}/{w.total} fallos</span>)}</div><Link to="/academia/entrenamiento?modo=lectura&fallos=1" className="btn sm" style={{ marginTop: 10 }}>Practicar mis fallos</Link></div>}
      {!courses.data ? <Spinner /> : [1, 2, 3].map((lv) => {
        const cs = courses.data!.filter((c) => c.level === lv);
        if (!cs.length) return null;
        return (
          <section key={lv} className="stack">
            <div><h2>{LEVELS[lv].t}</h2><p className="small muted">{LEVELS[lv].d}</p></div>
            <div className="grid cols-3">{cs.map((c) => (
              <Link key={c.id} to={`/academia/curso/${c.id}`} className="card hover stack sm">
                <div className="row between"><GraduationCap size={20} />{c.status !== 'publicado' && <span className="badge warn">{c.status}</span>}</div>
                <h3>{c.title}</h3><p className="small muted">{c.description}</p>
                <div className="bar"><i style={{ width: `${c.lessons ? (c.completed / c.lessons) * 100 : 0}%` }} /></div>
                <div className="row between xs muted"><span>{c.completed}/{c.lessons} lecciones</span><ChevronRight size={14} /></div>
              </Link>
            ))}</div>
          </section>
        );
      })}
      {creating && <CourseForm onClose={() => setCreating(false)} onDone={() => { setCreating(false); courses.reload(); }} />}
    </div>
  );
}

function CourseForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const struct = useLoad(() => get<any[]>('/org/structure'), []);
  const [f, setF] = useState({ level: 1, title: '', description: '', section_id: '' });
  return (
    <Modal title="Nuevo curso" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!f.title} onClick={async () => { try { await post('/academy/courses', { ...f, level: Number(f.level), section_id: f.section_id ? Number(f.section_id) : null }); onDone(); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } }}>Crear (borrador)</button></>}>
      <div className="stack">
        <Field label="Nivel"><select className="input" value={f.level} onChange={(e) => setF({ ...f, level: Number(e.target.value) })}>{[1, 2, 3].map((l) => <option key={l} value={l}>{LEVELS[l].t}</option>)}</select></Field>
        <Field label="Título"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Descripción"><textarea className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Específico de sección (opcional)"><select className="input" value={f.section_id} onChange={(e) => setF({ ...f, section_id: e.target.value })}><option value="">Todas</option>{(struct.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      </div>
    </Modal>
  );
}
