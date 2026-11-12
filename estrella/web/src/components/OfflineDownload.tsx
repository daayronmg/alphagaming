import { useState } from 'react';
import { CloudDownload, CheckCircle2 } from './icons';
import { useToast } from './ui';
import { downloadForOffline, offlineSavedAt } from '../lib/offline';
import { fmtRelative } from '../lib/format';

/** Descarga todas tus marchas para tocarlas sin cobertura (procesiones, locales sin wifi). */
export function OfflineDownload() {
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
  return (
    <div className="offline-dl">
      <button className="btn sm" onClick={go} disabled={busy} data-testid="offline-download">
        <CloudDownload size={15} /> {busy ? `Guardando ${prog[0]} de ${prog[1]}…` : 'Guardar para tocar sin cobertura'}
      </button>
      {!busy && at && <span className="xs faint"><CheckCircle2 size={12} /> Guardadas {fmtRelative(at.toISOString())}</span>}
    </div>
  );
}
