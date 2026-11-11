import { useEffect, useState } from 'react';
import { ScanFace } from './icons';
import { Modal, useToast } from './ui';
import { shouldOfferPasskey, addPasskey, declinePasskey, passkeyError, unlockName } from '../lib/passkey';

/** Una vez por dispositivo: propone entrar con Face ID / huella la próxima vez. */
export function PasskeyOffer() {
  const toast = useToast();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(() => { shouldOfferPasskey().then(setShow); }, 1200); return () => clearTimeout(t); }, []);
  if (!show) return null;
  const name = unlockName();
  const yes = async () => {
    setBusy(true);
    try { await addPasskey(); toast({ kind: 'ok', text: `Listo: la próxima vez entras con ${name}.` }); setShow(false); }
    catch (e) { const m = passkeyError(e); if (m) toast({ kind: 'error', text: m }); } finally { setBusy(false); }
  };
  return (
    <Modal title={`¿Entrar con ${name}?`} onClose={() => { declinePasskey(); setShow(false); }}
      footer={<><button className="btn" onClick={() => { declinePasskey(); setShow(false); }}>Ahora no</button><button className="btn primary" disabled={busy} onClick={yes}><ScanFace size={18} /> Activar</button></>}>
      <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <ScanFace size={56} />
        <p style={{ margin: 0 }}>Actívalo y no tendrás que escribir la contraseña: miras al móvil y dentro.</p>
        <p className="small muted" style={{ margin: 0 }}>Tu cara o tu huella no salen del móvil; la app solo recibe una llave segura.</p>
      </div>
    </Modal>
  );
}
