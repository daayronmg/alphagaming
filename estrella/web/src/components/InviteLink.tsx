import { useState } from 'react';
import { Copy, Share2, Link2, Trash2 } from './icons';
import { get, post, del } from '../lib/api';
import { useLoad, useToast } from './ui';
import { fmtDateTime } from '../lib/format';

const DURATIONS = [
  { h: 24, l: '1 día' }, { h: 48, l: '2 días' }, { h: 72, l: '3 días' }, { h: 168, l: '1 semana' }, { h: 720, l: '1 mes' },
];

/** La dirección crea un enlace de alta para compartir por WhatsApp; caduca cuando ella elige. */
export function InviteLink() {
  const toast = useToast();
  const [hours, setHours] = useState(48);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useLoad(() => get<any[]>('/members/invitations/list'), []);
  const active = (list.data ?? []).filter((i) => i.open && new Date(i.expires_at) > new Date());
  const make = async () => {
    const h = custom ? Math.round(Number(custom) * 24) : hours;
    if (!h || h < 1) return toast({ kind: 'error', text: 'Indica cuántos días.' });
    setBusy(true);
    try { await post('/members/invitations/open', { hours: Math.min(h, 24 * 90) }); setCustom(''); await list.reload(); toast({ kind: 'ok', text: 'Enlace creado. Compártelo por WhatsApp.' }); }
    catch (e) { toast({ kind: 'error', text: (e as Error).message }); } finally { setBusy(false); }
  };
  const copy = async (link: string) => { try { await navigator.clipboard.writeText(link); toast({ kind: 'ok', text: 'Enlace copiado' }); } catch { prompt('Copia el enlace:', link); } };
  const share = (i: any) => {
    const text = `Únete a la app de la banda: elige tu instrumento y tu voz y listo.\n${i.link}\n(Vale hasta el ${fmtDateTime(i.expires_at)})`;
    if (navigator.share) navigator.share({ title: 'Únete a la banda', text }).catch(() => {});
    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };
  return (
    <div className="card stack">
      <div><h3 style={{ margin: 0 }}><Link2 size={18} /> Invitar con un enlace</h3>
        <p className="muted small" style={{ margin: '4px 0 0' }}>Crea un enlace, pásalo por el grupo y cada uno se da de alta con su nombre, teléfono, instrumento y voz. Entran como componentes; la dirección solo la das tú desde su ficha.</p></div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="small muted">Que dure:</span>
        {DURATIONS.map((d) => <button key={d.h} type="button" className={`btn sm ${!custom && hours === d.h ? 'primary' : ''}`} onClick={() => { setHours(d.h); setCustom(''); }}>{d.l}</button>)}
        <input className="input" style={{ width: 110 }} type="number" min={1} max={90} inputMode="numeric" placeholder="Otros días" value={custom} onChange={(e) => setCustom(e.target.value)} />
        <button type="button" className="btn primary" disabled={busy} onClick={make}>{busy ? 'Creando…' : 'Crear enlace'}</button>
      </div>
      {active.map((i) => (
        <div key={i.code} className="stack" style={{ gap: 6, borderTop: '1px solid var(--line, #ddd)', paddingTop: 10 }}>
          <div className="invite-link">
            <input className="input mono xs" readOnly value={i.link} onFocus={(e) => e.target.select()} aria-label="Enlace de invitación" />
            <button type="button" className="btn sm" onClick={() => copy(i.link)}><Copy size={14} /> Copiar</button>
            <button type="button" className="btn sm primary" onClick={() => share(i)}><Share2 size={14} /> Compartir</button>
            <button type="button" className="btn sm ghost" aria-label="Anular enlace" onClick={async () => { await del(`/members/invitations/${i.code}`); list.reload(); }}><Trash2 size={14} /></button>
          </div>
          <div className="small muted">Caduca el {fmtDateTime(i.expires_at)} · {i.uses === 1 ? '1 persona se ha apuntado' : `${i.uses} personas se han apuntado`}</div>
        </div>
      ))}
    </div>
  );
}
