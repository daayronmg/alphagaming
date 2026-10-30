import { useState } from 'react';
import { Download, Info } from '../components/icons';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Spinner, ErrorBox, Field } from '../components/ui';
import { fmtDate } from '../lib/format';

const NATURE: Record<string, { label: string; cls: string }> = { objetivo: { label: 'Dato objetivo', cls: 'ok' }, estimacion: { label: 'Estimación', cls: 'warn' }, manual: { label: 'Valoración manual', cls: 'info' } };

function Block({ b, title, children }: { b: any; title: string; children: React.ReactNode }) {
  return (
    <div className="card stack sm">
      <div className="card-title"><h3>{title}</h3><span className={`badge ${NATURE[b.nature].cls}`}>{NATURE[b.nature].label}</span></div>
      <p className="xs muted"><Info size={12} style={{ verticalAlign: -2 }} /> {b.note}</p>
      {b.rows.length ? children : <p className="small muted">Sin datos en el periodo.</p>}
    </div>
  );
}
const Bar = ({ v, max, label }: { v: number; max: number; label: string }) => (
  <div className="stack" style={{ gap: 2 }}><div className="row between small"><span>{label}</span><span className="mono">{v}{max === 100 ? '%' : ''}</span></div><div className="bar"><i style={{ width: `${max ? (v / max) * 100 : 0}%` }} /></div></div>
);

export default function Stats() {
  const { can } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const s = useLoad(() => get(`/stats?${from ? `from=${from}&` : ''}${to ? `to=${to}` : ''}`), [from, to]);
  if (s.error) return <div className="page"><ErrorBox error={s.error} /></div>;
  if (!s.data) return <Spinner />;
  const B = s.data.blocks;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  return (
    <div className="page stack lg">
      <div className="page-head">
        <div><div className="eyebrow">Ayuda a la decisión</div><h1>Estadísticas de dirección</h1><p className="small muted" style={{ marginTop: 6 }}>Periodo: {fmtDate(s.data.period.from)} – {fmtDate(s.data.period.to)} (por defecto, la temporada desde septiembre)</p></div>
        <div className="row"><Field label="Desde"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="Hasta"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          {can('stats.view') && <a className="btn" href="/api/stats/report.csv" style={{ alignSelf: 'flex-end' }}><Download size={16} /> Informe CSV</a>}</div>
      </div>
      <div className="notice info"><Info size={18} /><span className="small">Estas cifras sirven para organizar la banda. No indican si alguien toca bien o mal, ni deben usarse para comparar a los componentes entre sí.</span></div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Block b={B.attendanceByMonth} title="Asistencia por mes">
          {B.attendanceByMonth.rows.map((r: any) => { const tot = r.presente + r.retraso + r.ausente + r.justificada; return <Bar key={r.month} label={`${r.month} · ${r.eventos} eventos`} v={pct(r.presente + r.retraso, tot)} max={100} />; })}
          <p className="xs faint">% de presencia (presente + retraso) sobre registros.</p>
        </Block>
        <Block b={B.attendanceBySection} title="Participación por sección">
          {B.attendanceBySection.rows.map((r: any) => <Bar key={r.id} label={`${r.name} · ${r.retrasos} retrasos`} v={pct(r.asistencias, r.registros)} max={100} />)}
        </Block>
        <Block b={B.pendingConfirmations} title="Confirmaciones pendientes">
          {B.pendingConfirmations.rows.map((r: any) => <div key={r.id} className="row small"><span className="grow">{r.title} · {fmtDate(r.starts_at)}</span><span className="badge ok">{r.confirmed - r.declined} sí</span><span className="badge danger">{r.declined} no</span><span className="badge warn">{Math.max(0, r.convoked - r.confirmed)} sin responder</span></div>)}
        </Block>
        <Block b={B.courses} title="Cursos de la academia">
          {B.courses.rows.map((r: any) => <div key={r.title} className="row small"><span className="grow">N{r.level} · {r.title}</span><span className="badge">{r.people_with_progress} personas</span><span className="badge">{r.lessons_completed} lecciones completadas</span></div>)}
        </Block>
        <Block b={B.exercises} title="Evolución de los ejercicios">
          {B.exercises.rows.slice(-10).map((r: any, i: number) => <Bar key={i} label={`Semana ${r.week} · ${r.exercise} · ${r.people} personas`} v={pct(r.correct, r.total)} max={100} />)}
        </Block>
        <Block b={B.marchasStudied} title="Marchas consultadas">
          {B.marchasStudied.rows.map((r: any) => <Bar key={r.title} label={`${r.title} · ${r.people} personas`} v={r.opens} max={Math.max(...B.marchasStudied.rows.map((x: any) => x.opens))} />)}
        </Block>
        <Block b={B.repeatedPassages} title="Pasajes trabajados repetidamente">
          {B.repeatedPassages.rows.map((r: any, i: number) => <div key={i} className="small">{r.title} · c.{r.measure_from}–{r.measure_to} · <strong>{r.times} ensayos</strong></div>)}
        </Block>
        <Block b={B.repeatedDoubts} title="Zonas con varias dudas">
          {B.repeatedDoubts.rows.map((r: any, i: number) => <div key={i} className="small">{r.title} · {r.measure ? `c.${r.measure}` : `pág. ${r.page}`} · <strong>{r.total} dudas</strong></div>)}
        </Block>
        <Block b={B.syncIncidents} title="Sincronización de dispositivos">
          {B.syncIncidents.rows.map((r: any) => <div key={r.kind} className="row small"><span className="grow">{r.kind === 'late_command' ? 'Órdenes recibidas tarde' : r.kind === 'connect' ? 'Conexiones' : r.kind === 'disconnect' ? 'Desconexiones' : r.kind}</span><span className="badge">{r.total} · {r.devices} dispositivos{r.avg_late_ms ? ` · media ${r.avg_late_ms} ms` : ''}</span></div>)}
        </Block>
        <Block b={B.materialUsage} title="Uso de materiales">
          {B.materialUsage.rows.map((r: any) => <div key={r.kind} className="row small"><span className="grow">{r.kind === 'marcha' ? 'Fichas de marchas' : r.kind === 'parte' ? 'Partituras abiertas' : r.kind}</span><span className="badge">{r.total} · {r.people} personas</span></div>)}
        </Block>
      </div>
      <Block b={B.attendanceByPerson} title="Asistencia por componente">
        <div className="table-wrap"><table className="table"><thead><tr><th>Componente</th><th>Sección</th><th>Registros</th><th>Presente</th><th>Retraso</th><th>Ausente</th><th>Justificada</th><th>Min. tarde</th></tr></thead>
          <tbody>{B.attendanceByPerson.rows.map((r: any) => <tr key={r.id}><td>{r.name}</td><td>{r.section ?? '—'}</td><td>{r.registros}</td><td>{r.presente}</td><td>{r.retraso}</td><td>{r.ausente}</td><td>{r.justificada}</td><td>{r.minutos_tarde}</td></tr>)}</tbody></table></div>
      </Block>
    </div>
  );
}
