import { useState } from 'react';
import { CloudDownload, CheckCircle2 } from './icons';
import { useToast } from './ui';
import { downloadForOffline, offlineSavedAt } from '../lib/offline';
import { fmtRelative } from '../lib/format';

/** Descarga todas tus marchas para tocarlas sin cobertura (procesiones, locales sin wifi). */
export function OfflineDownload({ card }: { card?: boolean } = {}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<[number, number]>([0, 0]);
  const [at, setAt] = useState(offlineSavedAt());
  const go = async () => {
    if (!navigator.onLine) return toast({ kind: 'error', text: 'Ahora no hay conexión: descárgalas cuando tengas wifi o datos.' });
    setBusy(true);
    try {
      const r = await downloadForOffline((d, t) => setProg([d, t]));
      setAt(offlineSavedAt());
      toast({ kind: 'ok', text: `Listo: ${r.ok} marchas guardadas en el móvil. Ya puedes tocarlas sin cobertura.` });
    } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };
  if (card) {
    // versión destacada (arriba en Inicio y en Marchas): se ve sin bajar y dice si ya están guardadas
    return (
      <div className={`card offline-card ${at ? 'saved' : ''}`} data-testid="offline-card">
        <div className="offline-ico">{at ? <CheckCircle2 size={22} /> : <CloudDownload size={22} />}</div>
        <div className="grow">
          <strong>Marchas sin cobertura</strong>
          <div className="small muted">{busy ? `Guardando ${prog[0]} de ${prog[1]}…` : at ? `Guardadas en este aparato ${fmtRelative(at.toISOString())}. Vuelve a guardar si hay marchas nuevas.` : 'Aún no están guardadas en este aparato. Hazlo con wifi.'}</div>
        </div>
        <button className={`btn ${at ? '' : 'primary'}`} onClick={go} disabled={busy} data-testid="offline-download">
          <CloudDownload size={17} /> {busy ? `${prog[0]}/${prog[1]}` : at ? 'Actualizar' : 'Guardar'}
        </button>
      </div>
    );
  }
  return (
    <div className="offline-dl">
      <button className="btn sm" onClick={go} disabled={busy} data-testid="offline-download">
        <CloudDownload size={15} /> {busy ? `Guardando ${prog[0]} de ${prog[1]}…` : 'Guardar para tocar sin cobertura'}
      </button>
      {!busy && at && <span className="xs faint"><CheckCircle2 size={12} /> Guardadas {fmtRelative(at.toISOString())}</span>}
    </div>
  );
}
