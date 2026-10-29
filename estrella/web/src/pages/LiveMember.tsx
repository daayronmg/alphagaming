import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Radio, Volume2, VolumeX, Eye, EyeOff, BellOff, Repeat, Music, FileText, FileMusic } from '../components/icons';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Spinner, Notice, Empty, ErrorBox } from '../components/ui';
import { useLiveSession, positionAt, audienceMatches } from '../lib/live';
import { rt, useTick, useRealtime, useConn } from '../lib/realtime';
import PartWorkspace from '../components/PartWorkspace';
import StaffView, { ColorLegend } from '../components/StaffView';
import { startMetronome, playScores, type ScorePlayback } from '../lib/audio';
import { fmtTime } from '../lib/format';

export default function LiveMember() {
  const { id } = useParams();
  const nav = useNavigate();
  const active = useLoad(() => (id ? Promise.resolve(null) : get<any[]>('/live/active')), [id]);
  useEffect(() => { if (!id && active.data?.length) nav(`/directo/${active.data[0].id}`, { replace: true }); }, [id, active.data]); // eslint-disable-line
  useRealtime((m) => { if (!id && m.t === 'live:started') nav(`/directo/${m.sessionId}`); }, [id]);
  if (!id) {
    if (active.loading) return <Spinner />;
    return <div className="page"><Empty icon={<Radio size={40} />} title="No hay ningún ensayo en directo">Cuando la dirección inicie la sesión, esta pantalla se abrirá sola con tu partitura.</Empty></div>;
  }
  return <LiveSession id={id} />;
}

function LiveSession({ id }: { id: string }) {
  const { me } = useAuth();
  const conn = useConn();
  const [partId, setPartId] = useState<string | null>(null);
  const live = useLiveSession(id, partId);
  const s = live.state;
  const [resolution, setResolution] = useState<any>(null);
  const [follow, setFollow] = useState(true);
  const [sound, setSound] = useState(false);
  const [beat, setBeat] = useState<number | null>(null);
  const [localView, setLocalView] = useState<'auto' | 'pdf' | 'score'>('auto');
  const [score, setScore] = useState<any>(null);
  const resolvedFor = useRef<string | null>(null);

  // parte personalizada: se resuelve cada vez que cambia la marcha (o la asignación)
  const resolve = async () => {
    if (!s?.marchaId) { setResolution(null); setPartId(null); return; }
    const r = await get(`/live/${id}/my-part`);
    resolvedFor.current = s.marchaId;
    setResolution(r); setPartId(r.part?.id ?? null);
    if (r.score) setScore(await get(`/scores/${r.score.id}`).catch(() => null)); else setScore(null);
  };
  useEffect(() => { resolve(); }, [s?.marchaId]); // eslint-disable-line
  useRealtime((m) => {
    if (m.t === 'live:part-changed' || m.t === 'me:changed') resolve();
    if (m.t === 'parts:changed' && m.marchaId === s?.marchaId) resolve();
    if (m.t === 'score:published' && m.marchaId === s?.marchaId) resolve();
  }, [s?.marchaId]);

  useEffect(() => { localStorage.setItem('estrella.liveSilent', s?.silent ? '1' : '0'); return () => localStorage.removeItem('estrella.liveSilent'); }, [s?.silent]);

  const playing = s?.transport.status === 'playing';
  useTick(120, playing);
  const now = rt.serverNow();
  const countdown = playing && s ? Math.max(0, s.transport.anchorTs - now) : 0;
  const pos = s ? positionAt(s, now) : 1;
  const currentMeasure = s ? (playing ? Math.floor(pos) : s.highlight?.measure ?? s.measure) : null;

  // metrónomo sincronizado: arranca en el instante programado por el director (reloj del servidor → local)
  useEffect(() => {
    if (!s || !playing || !s.metronome) { setBeat(null); return; }
    const beatMs = 60000 / s.tempo;
    const sinceAnchor = rt.serverNow() - s.transport.anchorTs;
    const nextBeatServer = s.transport.anchorTs + Math.max(0, Math.ceil(sinceAnchor / beatMs)) * beatMs;
    const startLocal = performance.now() + (nextBeatServer - rt.serverNow());
    const firstBeatIndex = Math.round((nextBeatServer - s.transport.anchorTs) / beatMs);
    let k = firstBeatIndex;
    const stop = startMetronome(s.tempo, 10_000, () => { setBeat(k % s.beatsPerMeasure); k++; }, startLocal);
    return () => stop();
  }, [s?.transport.anchorTs, s?.transport.status, s?.metronome, s?.tempo, s?.beatsPerMeasure, live.version]); // eslint-disable-line

  // sonido guía sintético de mi parte, sincronizado con el arranque
  const pb = useRef<ScorePlayback | null>(null);
  useEffect(() => {
    pb.current?.stop(); pb.current = null;
    if (!sound || !s || !playing || !score?.published) return;
    const fromM = Math.floor(positionAt(s, Math.max(rt.serverNow(), s.transport.anchorTs)));
    const delay = Math.max(0, s.transport.anchorTs - rt.serverNow()) / 1000;
    pb.current = playScores([{ doc: score.published, gain: 0.8 }], { from: fromM, to: s.loop?.to ?? score.published.measures.length, tempo: s.tempo, loop: !!s.loop, startDelay: delay + 0.05 });
    return () => { pb.current?.stop(); pb.current = null; };
  }, [sound, s?.transport.anchorTs, s?.transport.status, score?.id, live.version]); // eslint-disable-line

  if (live.error && !s) return <div className="page"><ErrorBox error={live.error} retry={live.reload} /></div>;
  if (!s) return <Spinner label="Conectando con el ensayo…" />;
  if (live.ended) return <div className="page"><Notice kind="info" title="El ensayo en directo ha terminado">Gracias. Puedes seguir estudiando desde la biblioteca.</Notice></div>;

  const msgs = s.messages.filter((m) => audienceMatches(m.audience, me?.sectionIds ?? [], me?.role === 'director'));
  const view = localView !== 'auto' ? localView : s.view;
  const showScore = (view === 'score' && score?.published) || (view === 'auto' && !resolution?.part && score?.published);
  const syncState = conn !== 'conectado' ? 'desconectado' : live.syncing ? 'sincronizando' : 'conectado';

  const header = (
    <div className="stack sm" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', background: 'var(--bg-2)' }} data-testid="live-header">
      <div className="row between">
        <div className="row nowrap" style={{ minWidth: 0 }}>
          <span className={`dot-status ${syncState === 'conectado' ? 'on' : syncState === 'sincronizando' ? 'sync' : 'off'}`} title={syncState} data-testid="live-sync" data-state={syncState} />
          <div style={{ minWidth: 0 }}>
            <div className="xs faint">Ensayo en directo · {live.session?.director_name}{live.session?.event_title ? ` · ${live.session.event_title}` : ''}</div>
            <div style={{ fontWeight: 750, fontSize: '1.05rem' }} className="ellipsis" data-testid="live-marcha">{s.marchaTitle ?? 'Esperando a que la dirección envíe una marcha…'}</div>
          </div>
        </div>
        <div className="row nowrap">
          {s.marchaId && <>
            <span className={`transport-state ${s.transport.status}`} data-testid="live-transport">{countdown > 0 ? `Entrada en ${(countdown / 1000).toFixed(1)} s` : s.transport.status === 'playing' ? 'Sonando' : s.transport.status === 'paused' ? 'En pausa' : 'Detenido'}</span>
            <div className="stack" style={{ alignItems: 'center', gap: 0 }}><span className="xs faint">Compás</span><span style={{ fontFamily: 'var(--font-display)', fontSize: '1.9rem', fontWeight: 700, lineHeight: 1 }} data-testid="live-measure">{currentMeasure}</span></div>
          </>}
        </div>
      </div>
      {s.marchaId && <div className="row" style={{ gap: 6 }}>
        {resolution?.assignment && <span className="badge accent" data-testid="live-assignment"><Music size={12} /> {resolution.assignment.instrument}{resolution.assignment.voice ? ` · ${resolution.assignment.voice}` : ''}</span>}
        {resolution?.part && <span className="badge" data-testid="live-part-label"><FileText size={12} /> {resolution.part.label} v{resolution.part.version}</span>}
        {resolution?.score && <span className="badge"><FileMusic size={12} /> editable v{resolution.score.version_number}</span>}
        {s.section && <span className="badge info">{s.section.name}</span>}
        {s.loop && <span className="badge" style={{ background: 'rgba(168,85,247,.2)', color: '#c084fc' }}><Repeat size={12} /> c.{s.loop.from}–{s.loop.to}</span>}
        <span className="badge">♩ = {s.tempo}</span>
        {s.metronome && playing && <span className="row" style={{ gap: 4 }}>{Array.from({ length: s.beatsPerMeasure }).map((_, i) => <span key={i} className={`beat ${beat === i ? 'on' : ''} ${i === 0 ? 'first' : ''}`} style={{ width: 12, height: 12 }} />)}</span>}
        {s.silent && <span className="badge"><BellOff size={12} /> Silencio de avisos</span>}
        {live.lateMs != null && live.lateMs > 150 && <span className="badge warn" title="La orden llegó tarde: se ha recalculado tu posición">Recalculado (+{live.lateMs} ms)</span>}
        <span className="grow" />
        <button className={`btn sm ${follow ? 'on' : ''}`} onClick={() => setFollow(!follow)} data-testid="follow-toggle">{follow ? <Eye size={14} /> : <EyeOff size={14} />} Seguir al director</button>
        {score?.published && <button className={`btn sm ${sound ? 'on' : ''}`} onClick={() => setSound(!sound)} title="Sonido guía sintético de tu parte">{sound ? <Volume2 size={14} /> : <VolumeX size={14} />} Guía</button>}
        {resolution?.part && score?.published && <select className="input" style={{ width: 'auto', minHeight: 32 }} value={localView} onChange={(e) => setLocalView(e.target.value as any)}><option value="auto">Vista: la que indique la dirección</option><option value="pdf">PDF original</option><option value="score">Partitura editable</option></select>}
      </div>}
      {msgs[0] && Date.now() - msgs[0].at < 10 * 60_000 && <div className="director-msg" data-testid="director-message">📣 {msgs[0].text} <span className="xs faint" style={{ fontWeight: 400 }}>· {fmtTime(new Date(msgs[0].at))}</span></div>}
    </div>
  );

  if (!s.marchaId) return <div className="page flush">{header}<div className="page"><Empty icon={<Radio size={40} />} title="Conectado al ensayo">Cuando la dirección envíe una marcha, tu partitura aparecerá aquí automáticamente.</Empty></div></div>;
  if (!resolution || resolvedFor.current !== s.marchaId) return <div className="page flush">{header}<Spinner label="Buscando tu parte…" /></div>;

  if (resolution.status !== 'ok') {
    return (
      <div className="page flush">{header}
        <div className="page stack">
          <Notice kind="warn" title="Tu partitura no está disponible" >{resolution.message} No se muestra la parte de otra voz como si fuera la tuya. Avisa a la dirección o a tu responsable.</Notice>
          {resolution.available.length > 0 && <p className="small muted">Partes disponibles en esta marcha: {resolution.available.map((a: any) => a.label).join(', ')}.</p>}
          {resolution.reference && <Link className="btn" to={`/partitura/${resolution.reference.id}`}>Ver la partitura general (referencia)</Link>}
          <div className="card"><div className="row"><span className="small muted">La dirección está en el compás</span><span className="measure-display" style={{ fontSize: '3rem' }}>{currentMeasure}</span></div></div>
        </div>
      </div>
    );
  }

  if (showScore) {
    return (
      <div className="page flush">
        {header}
        <div className="page wide stack" data-testid="live-score">
          <ColorLegend />
          <div className="staff-paper"><StaffView doc={score.published} colorMode={localStorage.getItem('estrella.colors') !== '0'} currentMeasure={follow ? currentMeasure : null} loop={s.loop} /></div>
        </div>
      </div>
    );
  }

  return (
    <PartWorkspace key={resolution.part.id} partId={resolution.part.id} eventId={live.session?.event_id} header={header}
      live={{ measure: currentMeasure, loop: s.loop, sectionName: s.section?.name, follow: follow && s.follow, showAnnotations: s.showAnnotations, key: playing ? currentMeasure ?? 0 : live.version }} />
  );
}

