import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MessageCircleQuestion, Star, Copy } from '../components/icons';
import { get, fileUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Spinner, Empty, Tabs, ErrorBox } from '../components/ui';
import { useRealtime } from '../lib/realtime';
import DoubtThread from '../components/DoubtThread';
import { fmtRelative } from '../lib/format';

export default function Doubts() {
  const { id } = useParams();
  const { can, canSection } = useAuth();
  const nav = useNavigate();
  const manager = can('scores.publish') || canSection('doubts');
  const [scope, setScope] = useState<'inbox' | 'mine'>(manager ? 'inbox' : 'mine');
  const [status, setStatus] = useState('');
  const [group, setGroup] = useState<'ninguno' | 'marcha' | 'voz'>('ninguno');
  const [prio, setPrio] = useState(false);
  const list = useLoad(() => get<any[]>(`/doubts?scope=${scope}${status && scope === 'inbox' ? `&status=${status}` : ''}${prio ? '&priority=1' : ''}`), [scope, status, prio]);
  useRealtime((m) => { if (m.t?.startsWith('doubt:')) list.reload(); }, [scope, status, prio]);

  const rows = list.data ?? [];
  const groups: [string, any[]][] = group === 'ninguno' ? [['', rows]] : Object.entries(rows.reduce((a: any, d) => {
    const k = group === 'marcha' ? d.marcha_title : `${d.instrument ?? 'General'}${d.voice ? ' · ' + d.voice : ''}`;
    (a[k] ??= []).push(d); return a;
  }, {}));

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Comunicación con la dirección</div><h1>{scope === 'inbox' ? 'Bandeja de dudas' : 'Mis dudas'}</h1></div>
        {manager && <Tabs value={scope} onChange={setScope} items={[{ value: 'inbox', label: 'Bandeja' }, { value: 'mine', label: 'Mis dudas' }]} />}
      </div>
      <div className="grid" style={{ gridTemplateColumns: id ? 'minmax(280px, 400px) minmax(0, 1fr)' : '1fr', alignItems: 'start' }}>
        <div className="stack">
          {scope === 'inbox' && (
            <div className="row">
              <div className="chips">{[['', 'Todas'], ['nueva', 'Nuevas'], ['pendiente', 'Pendientes'], ['respondida', 'Respondidas']].map(([v, l]) => <button key={v} className={`chip ${status === v ? 'on' : ''}`} onClick={() => setStatus(v)}>{l}</button>)}</div>
              <button className={`chip ${prio ? 'on' : ''}`} onClick={() => setPrio(!prio)}><Star size={13} /> Prioritarias</button>
              <select className="input" style={{ width: 'auto' }} value={group} onChange={(e) => setGroup(e.target.value as any)}><option value="ninguno">Sin agrupar</option><option value="marcha">Agrupar por marcha</option><option value="voz">Agrupar por instrumento/voz</option></select>
            </div>
          )}
          {list.error && <ErrorBox error={list.error} retry={list.reload} />}
          {list.loading && !list.data && <Spinner />}
          {list.data && !rows.length && <Empty icon={<MessageCircleQuestion size={36} />} title="No hay dudas">{scope === 'mine' ? 'Desde cualquier partitura pulsa «Tengo una duda» y selecciona la zona.' : 'Todo al día.'}</Empty>}
          {groups.map(([g, ds]) => (
            <div key={g} className="stack sm">
              {g && <div className="xs faint" style={{ textTransform: 'uppercase', letterSpacing: '.1em', marginTop: 8 }}>{g} ({ds.length})</div>}
              {ds.map((d) => (
                <button key={d.id} className={`card flat tight hover row nowrap ${d.id === id ? 'on' : ''}`} style={{ textAlign: 'left', cursor: 'pointer', borderColor: d.id === id ? 'var(--accent)' : undefined, background: 'var(--surface)' }} onClick={() => nav(`/dudas/${d.id}`)}>
                  {d.crop_file_id ? <img src={fileUrl(d.crop_file_id)} alt="" style={{ width: 70, height: 46, objectFit: 'cover', borderRadius: 8, background: '#fff', flex: 'none' }} /> : <MessageCircleQuestion size={22} />}
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 6 }}><strong className="small">{d.author_name}</strong><span className="xs faint">{d.instrument}{d.voice ? ` · ${d.voice}` : ''}</span></div>
                    <div className="small ellipsis">{d.text}</div>
                    <div className="xs muted">{d.marcha_title} · p.{d.page}{d.measure ? ` · c.${d.measure}` : ''} · {fmtRelative(d.created_at)}</div>
                  </div>
                  <div className="stack sm" style={{ alignItems: 'flex-end' }}>
                    <span className={`badge ${d.status === 'respondida' ? 'ok' : d.status === 'nueva' ? 'warn' : 'info'}`}>{d.status}</span>
                    {d.priority && <Star size={14} color="var(--danger)" />}
                    {d.similar?.length > 0 && <span className="badge danger" title="Otras dudas sobre el mismo fragmento"><Copy size={11} /> {d.similar.length + 1}</span>}
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
        {id && <div className="card"><DoubtThread id={id} compact /><div style={{ marginTop: 10 }}><Link to="/dudas" className="small muted">Cerrar</Link></div></div>}
      </div>
    </div>
  );
}
