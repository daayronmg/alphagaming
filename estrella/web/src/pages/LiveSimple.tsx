import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio, Maximize, Minimize, X } from '../components/icons';
import { get } from '../lib/api';
import { useLoad, Spinner } from '../components/ui';
import { useLiveSession } from '../lib/live';
import { useRealtime } from '../lib/realtime';
import PlayMarcha from './PlayMarcha';

/**
 * Ensayo en directo para los músicos, a pantalla completa: muestra la marcha que ha puesto el director
 * y cambia sola en cuanto él elige otra. Se puede escuchar la parte y ver las notas en colores.
 */
export default function LiveSimple() {
  const active = useLoad(() => get<any[]>('/live/active'), []);
  const [id, setId] = useState<string | null>(null);
  // si el ensayo termina se mantiene la sesión para mostrar el aviso de fin; uno nuevo la sustituye
  useEffect(() => { if (active.data?.[0]?.id) setId(active.data[0].id); }, [active.data]);
  useRealtime((m) => { if (m.t === 'live:started') setId(m.sessionId); }, []);
  if (active.loading && !active.data) return <Spinner />;
  return (
    <div className="immersive">
      {id ? <Session id={id} /> : (
        <div className="live-wait">
          <span className="live-pulse"><Radio size={34} /></span>
          <h1>Esperando al director</h1>
          <p className="muted">Cuando empiece el ensayo, aquí aparecerá sola la marcha que ponga.</p>
          <Link to="/" className="btn lg">Volver al inicio</Link>
        </div>
      )}
    </div>
  );
}

function Session({ id }: { id: string }) {
  const live = useLiveSession(id);
  const s = live.state;
  const [full, setFull] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  return (
    <>
      <header className="live-bar">
        <span className="live-chip"><span className="dot-status on" /> En directo</span>
        <span className="grow ellipsis small muted">{live.ended ? 'El ensayo ha terminado' : s?.lastCommand?.by ? `Dirige ${s.lastCommand.by}` : 'Ensayo en directo'}</span>
        {'requestFullscreen' in document.documentElement && (
          <button className="btn icon ghost" onClick={toggleFull} aria-label="Pantalla completa">{full ? <Minimize size={20} /> : <Maximize size={20} />}</button>
        )}
        <Link to="/" className="btn icon ghost" aria-label="Salir"><X size={20} /></Link>
      </header>
      <div className="live-body">
        {live.ended ? (
          <div className="live-wait"><h1>El ensayo ha terminado</h1><Link to="/" className="btn lg primary">Volver al inicio</Link></div>
        ) : s?.marchaId ? (
          <PlayMarcha key={s.marchaId} marchaId={s.marchaId} embedded />
        ) : (
          <div className="live-wait">
            <span className="live-pulse"><Radio size={34} /></span>
            <h1>El director va a elegir la marcha</h1>
            <p className="muted">No toques nada: en cuanto la ponga, te sale aquí.</p>
          </div>
        )}
      </div>
    </>
  );
}
