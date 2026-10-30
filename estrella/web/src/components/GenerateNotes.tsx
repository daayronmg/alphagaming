import { useEffect, useRef, useState } from 'react';
import { Wand2, CheckCircle2, AlertTriangle } from './icons';
import { get, post } from '../lib/api';
import { transcribePdf } from '../lib/pdf';
import { Modal, Notice } from './ui';

interface Row { part_id: string; marcha_id: string; title: string; label: string; file_id: string; transposition: number; page_from: number | null; page_to: number | null }
interface Result { title: string; label: string; ok: boolean; text: string }

/**
 * Lee las notas de todas las partes en PDF que aún no las tienen y las publica para que se puedan escuchar.
 * Se hace en el navegador de la dirección, una parte detrás de otra.
 */
export default function GenerateNotes({ onClose, auto }: { onClose: () => void; auto?: boolean }) {
  const [pending, setPending] = useState<Row[] | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<Result[]>([]);
  const [current, setCurrent] = useState('');
  const stopRef = useRef(false);
  useEffect(() => { get<Row[]>('/scores/pdf/pending').then((r) => { setPending(r); if (auto && r.length) run(r); }).catch(() => setPending([])); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (rows: Row[]) => {
    setRunning(true); stopRef.current = false;
    // las marchas de un libreto comparten el mismo PDF: se descarga una sola vez
    const files = new Map<string, ArrayBuffer>();
    const fileData = async (id: string) => {
      if (!files.has(id)) { const r = await fetch(`/api/files/${id}`, { credentials: 'same-origin' }); if (!r.ok) throw new Error('No se pudo descargar el PDF.'); files.set(id, await r.arrayBuffer()); }
      return files.get(id)!.slice(0); // pdf.js se queda con la copia
    };
    for (const r of rows) {
      if (stopRef.current) break;
      setCurrent(`${r.title} · ${r.label}`);
      try {
        const t = await transcribePdf(await fileData(r.file_id), { title: r.title, transposition: r.transposition, range: r.page_from ? [r.page_from, r.page_to ?? r.page_from] : null });
        if (!t.notes) { setDone((d) => [...d, { title: r.title, label: r.label, ok: false, text: 'El PDF no trae las notas como texto musical' }]); continue; }
        await post(`/scores/pdf/${r.part_id}`, { content: t.doc, review: t.review, warnings: t.warnings.slice(0, 50) });
        setDone((d) => [...d, { title: r.title, label: r.label, ok: true, text: `${t.doc.measures.length} compases${t.review.length ? ` · ${t.review.length} por revisar` : ''}` }]);
      } catch (e) { setDone((d) => [...d, { title: r.title, label: r.label, ok: false, text: (e as Error).message }]); }
    }
    setCurrent(''); setRunning(false);
  };

  const total = pending?.length ?? 0;
  return (
    <Modal title="Sacar las notas de los PDF" wide onClose={() => { stopRef.current = true; onClose(); }}
      footer={running ? <button className="btn" onClick={() => { stopRef.current = true; }}>Parar</button>
        : <><button className="btn" onClick={onClose}>Cerrar</button>{!done.length && total > 0 && <button className="btn primary" onClick={() => run(pending!)}><Wand2 size={16} /> Empezar ({total})</button>}</>}>
      <div className="stack">
        <Notice kind="info">ESTRELLA lee las notas de cada partitura PDF (las exportadas de Sibelius) para que los músicos puedan escuchar su parte y ver el nombre de cada nota. Los compases que no cuadran quedan marcados para revisar. Las partituras editables hechas a mano nunca se tocan.</Notice>
        {pending === null && <p className="muted small">Buscando partituras…</p>}
        {pending && !total && !done.length && <p className="muted">Todas las partituras PDF ya tienen sus notas.</p>}
        {total > 0 && (
          <div className="stack sm">
            <div className="progress"><i style={{ width: `${(done.length / total) * 100}%` }} /></div>
            <div className="small muted">{done.length} de {total}{current ? ` · leyendo ${current}…` : ''}</div>
          </div>
        )}
        {done.length > 0 && (
          <div className="stack sm" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {[...done].reverse().map((d, i) => (
              <div key={i} className="row small nowrap">{d.ok ? <CheckCircle2 size={16} color="var(--ok)" /> : <AlertTriangle size={16} color="var(--warn)" />}<span className="grow ellipsis"><strong>{d.title}</strong> · {d.label}</span><span className="xs muted">{d.text}</span></div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
