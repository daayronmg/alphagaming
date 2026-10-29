import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Circle, Plus, Upload, Send } from '../components/icons';
import { get, put, post, upload } from '../lib/api';
import { useLoad, Spinner, ErrorBox, Modal, Field, useToast, Notice } from '../components/ui';

export default function CourseView() {
  const { id } = useParams();
  const toast = useToast();
  const nav = useNavigate();
  const c = useLoad(() => get(`/academy/courses/${id}`), [id]);
  const [mat, setMat] = useState(false);
  if (c.error) return <div className="page"><ErrorBox error={c.error} /></div>;
  if (!c.data) return <Spinner />;
  const x = c.data;
  const setStatus = async (status: string) => {
    try { await put(`/academy/courses/${id}`, { level: x.level, title: x.title, description: x.description, section_id: x.section_id, sort: x.sort, status }); c.reload(); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); }
  };
  return (
    <div className="page stack lg">
      <div className="page-head">
        <div><div className="eyebrow"><Link to="/academia">Academia</Link> · Nivel {x.level}</div><h1>{x.title}</h1><p className="muted" style={{ marginTop: 6 }}>{x.description}</p></div>
        {x.can_edit && <div className="row">
          {x.status !== 'publicado' && <span className="badge warn">{x.status}</span>}
          <button className="btn" onClick={async () => { const l = await post('/academy/lessons', { course_id: id, sort: x.lessons.length, title: 'Nueva lección', explanation: 'Explicación…', quiz: [] }); nav(`/academia/leccion/${l.id}?editar=1`); }}><Plus size={16} /> Lección</button>
          <button className="btn" onClick={() => setMat(true)}><Upload size={16} /> Material didáctico</button>
          {x.can_publish && x.status !== 'publicado' && <button className="btn primary" onClick={() => setStatus('publicado')}><Send size={16} /> Publicar curso</button>}
          {!x.can_publish && x.status === 'borrador' && <button className="btn primary" onClick={() => setStatus('revision')}>Enviar a revisión</button>}
        </div>}
      </div>
      <div className="stack sm">
        {x.lessons.map((l: any, i: number) => (
          <Link key={l.id} to={`/academia/leccion/${l.id}`} className="card flat tight hover row">
            {l.completed_at ? <CheckCircle2 color="var(--ok)" /> : <Circle className="faint" />}
            <span className="badge">{i + 1}</span>
            <span className="grow" style={{ fontWeight: 600 }}>{l.title}</span>
            {l.status !== 'publicado' && <span className="badge warn">{l.status === 'revision' ? 'en revisión' : 'borrador'}</span>}
            {l.quiz_score != null && <span className="badge ok">Test {l.quiz_score}%</span>}
          </Link>
        ))}
      </div>
      {mat && <Material courseId={id!} onClose={() => setMat(false)} onDone={(lid) => nav(`/academia/leccion/${lid}?editar=1`)} />}
    </div>
  );
}

function Material({ courseId, onClose, onDone }: { courseId: string; onClose: () => void; onDone: (id: string) => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [f, setF] = useState({ title: '', text: '' });
  return (
    <Modal title="Convertir material en lección" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!f.title} onClick={async () => {
      const fd = new FormData(); fd.append('course_id', courseId); fd.append('title', f.title); fd.append('text', f.text); if (file) fd.append('file', file);
      try { const r = await upload('/academy/materials', fd); toast({ kind: 'ok', text: r.note }); onDone(r.id); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); }
    }}>Crear borrador</button></>}>
      <div className="stack">
        <Notice kind="info">Se crea una lección en borrador con tu material. Después puedes pedir al asistente una propuesta de test (si la IA está configurada) y revisarla antes de publicar.</Notice>
        <Field label="Título"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Texto o apuntes"><textarea className="input" style={{ minHeight: 160 }} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Field>
        <Field label="Archivo (PDF, imagen o audio, opcional)"><input className="input" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
      </div>
    </Modal>
  );
}
