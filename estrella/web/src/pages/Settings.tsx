import { useState } from 'react';
import { Bell, KeyRound, Monitor, Download, Radio, UserRound } from '../components/icons';
import { get, put, post, del } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad, Field, useToast, Notice } from '../components/ui';
import { fmtDateTime, assignmentLabel } from '../lib/format';
import { autoFollowEnabled } from '../components/Layout';
import { ScanFace } from '../components/icons';
import { passkeySupported, addPasskey, myPasskeys, passkeyError, unlockName } from '../lib/passkey';

export default function Settings() {
  const { me, prefs, setPrefs, refresh } = useAuth();
  const toast = useToast();
  const sessions = useLoad(() => get<any[]>('/auth/sessions'), []);
  const [pw, setPw] = useState({ current: '', password: '', password2: '' });
  const [follow, setFollow] = useState(autoFollowEnabled());
  const [phone, setPhone] = useState(me?.phone ?? '');
  const noEmail = !!me && /@sin-correo\./.test(me.email);
  const [email, setEmail] = useState(noEmail ? '' : me?.email ?? '');
  const keys = useLoad(() => myPasskeys(), []);
  if (!me) return null;
  const savePrefs = async (p: typeof prefs) => { setPrefs(p); try { await put('/auth/prefs', p); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } };
  const cats: Record<string, string> = { avisos: 'Avisos no urgentes', eventos: 'Cambios en eventos', dudas: 'Respuestas a mis dudas', partituras: 'Nuevas versiones de partituras' };
  return (
    <div className="page stack lg" style={{ maxWidth: 820 }}>
      <div className="page-head"><div><div className="eyebrow">Personal</div><h1>Mi cuenta</h1></div></div>
      <div className="card stack">
        <h3><UserRound size={18} /> Perfil</h3>
        <div className="small">{me.name}</div>
        {noEmail && <Notice kind="warn" title="Pon tu correo">Sin correo no te llegan los avisos de ensayos ni los botones de Voy / No voy.</Notice>}
        <div className="form-grid"><Field label="Correo"><input className="input" type="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} /></Field></div>
        <div className="small muted">Asignación: {me.assignments.map(assignmentLabel).join(', ') || 'sin asignar'} (solo la dirección puede cambiarla)</div>
        <div className="form-grid"><Field label="Teléfono"><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field></div>
        <label className="checkbox"><input type="checkbox" checked={me.share_contact} onChange={async (e) => { await put('/auth/profile', { share_contact: e.target.checked }); refresh(); }} /> Compartir mi correo y teléfono con los demás componentes</label>
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={async () => { try { await put('/auth/profile', { phone, ...(email && email !== me.email ? { email } : {}) }); refresh(); toast({ kind: 'ok', text: 'Guardado' }); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } }}>Guardar</button>
      </div>
      {passkeySupported() && <div className="card stack">
        <h3><ScanFace size={18} /> Entrar con {unlockName()}</h3>
        {(keys.data ?? []).map((k) => <div key={k.id} className="row small"><span className="grow">{k.device || 'Dispositivo'} · activado {fmtDateTime(k.created_at)}</span><button className="btn sm" onClick={async () => { await del(`/auth/passkey/${encodeURIComponent(k.id)}`); keys.reload(); }}>Quitar</button></div>)}
        {!keys.data?.length && <p className="small muted" style={{ margin: 0 }}>Actívalo y entrarás sin escribir la contraseña.</p>}
        <button className="btn sm primary" style={{ alignSelf: 'flex-start' }} onClick={async () => { try { await addPasskey(); keys.reload(); toast({ kind: 'ok', text: 'Activado en este dispositivo' }); } catch (e) { const m = passkeyError(e); if (m) toast({ kind: 'error', text: m }); } }}><ScanFace size={16} /> Activar en este dispositivo</button>
      </div>}
      <div className="card stack">
        <h3><Bell size={18} /> Notificaciones</h3>
        <label className="checkbox"><input type="checkbox" checked={prefs.mute_non_urgent} onChange={(e) => savePrefs({ ...prefs, mute_non_urgent: e.target.checked })} /> Silenciar todas las notificaciones no urgentes</label>
        {Object.entries(cats).map(([k, v]) => <label key={k} className="checkbox"><input type="checkbox" disabled={prefs.mute_non_urgent} checked={prefs.categories?.[k] !== false} onChange={(e) => savePrefs({ ...prefs, categories: { ...prefs.categories, [k]: e.target.checked } })} /> {v}</label>)}
        <Notice kind="info">Los avisos urgentes de la dirección siempre se muestran.</Notice>
      </div>
      <div className="card stack">
        <h3><Radio size={18} /> Ensayo en directo</h3>
        <label className="checkbox"><input type="checkbox" checked={follow} onChange={(e) => { setFollow(e.target.checked); localStorage.setItem('estrella.autofollow', e.target.checked ? '1' : '0'); }} /> Abrir automáticamente mi partitura cuando la dirección inicie un ensayo</label>
      </div>
      <div className="card stack">
        <h3><KeyRound size={18} /> Contraseña</h3>
        <div className="form-grid">
          <Field label="Actual"><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="Nueva"><input className="input" type="password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></Field>
          <Field label="Repetir"><input className="input" type="password" autoComplete="new-password" value={pw.password2} onChange={(e) => setPw({ ...pw, password2: e.target.value })} /></Field>
        </div>
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={!pw.current || !pw.password} onClick={async () => { if (pw.password !== pw.password2) return toast({ kind: 'error', text: 'No coinciden' }); try { await post('/auth/password', { current: pw.current, password: pw.password }); setPw({ current: '', password: '', password2: '' }); toast({ kind: 'ok', text: 'Contraseña cambiada. Se han cerrado tus otras sesiones.' }); sessions.reload(); } catch (e) { toast({ kind: 'error', text: (e as Error).message }); } }}>Cambiar contraseña</button>
      </div>
      <div className="card stack">
        <h3><Monitor size={18} /> Sesiones abiertas</h3>
        {(sessions.data ?? []).map((s) => <div key={s.id} className="row small"><span className="grow">{s.user_agent?.slice(0, 70) || 'Dispositivo'} · {fmtDateTime(s.last_seen_at)}</span>{s.current ? <span className="badge ok">Este dispositivo</span> : <button className="btn sm" onClick={async () => { await del(`/auth/sessions/${s.id}`); sessions.reload(); }}>Cerrar</button>}</div>)}
      </div>
      <div className="card stack">
        <h3><Download size={18} /> Mis datos</h3>
        <p className="small muted">Descarga una copia de tus datos personales en ESTRELLA. Para rectificar o suprimir datos, contacta con la dirección.</p>
        <a className="btn sm" style={{ alignSelf: 'flex-start' }} href="/api/auth/export">Descargar mis datos (JSON)</a>
      </div>
    </div>
  );
}
