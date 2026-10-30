import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2 } from '../components/icons';
import { post } from '../lib/api';
import { Notice, Spinner } from '../components/ui';

export default function Checkin() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    post(`/events/${id}/checkin`, { code: sp.get('c') ?? '' }).then(setR).catch((e) => setErr(e.message));
  }, [id]); // eslint-disable-line
  return (
    <div className="page" style={{ maxWidth: 520 }}>
      {!r && !err && <Spinner label="Registrando presencia…" />}
      {err && <Notice kind="danger" title="No se ha podido registrar">{err}</Notice>}
      {r && (
        <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <CheckCircle2 size={56} color="var(--ok)" />
          <h2>{r.duplicate ? 'Ya estabas registrado' : r.status === 'retraso' ? `Registrado con ${r.minutes_late} min de retraso` : '¡Presencia registrada!'}</h2>
          <Link className="btn primary" to={`/eventos/${id}`}>Ver el ensayo</Link>
        </div>
      )}
    </div>
  );
}
