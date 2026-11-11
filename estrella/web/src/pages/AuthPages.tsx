import { logoUrl } from '../components/Layout';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field, Notice } from '../components/ui';
import { passkeySupported, loginWithPasskey, passkeyError, unlockName } from '../lib/passkey';
import { ScanFace } from '../components/icons';
import { InstrumentIcon } from '../components/InstrumentIcon';

function Shell({ children }: { children: ReactNode }) {
  const { branding } = useAuth();
  return (
    <div className="auth-shell">
      <div className="auth-art">
        <div className="staff-lines" />
        <div style={{ position: 'relative' }}>
          <img src={logoUrl(branding)} alt="Escudo de la banda" style={{ width: 'clamp(84px, 18vw, 140px)', height: 'auto', marginBottom: 18, filter: 'drop-shadow(0 10px 22px rgba(0,0,0,.5))' }} />
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem, 5vw, 3.4rem)', fontWeight: 600, letterSpacing: '-.04em', lineHeight: 1.05 }}>Componentes Estrella</div>
          <p style={{ marginTop: 12, opacity: .85, maxWidth: 440 }}>{branding.bandName}</p>
        </div>
      </div>
      <div className="auth-form">{children}</div>
    </div>
  );
}

export function Login() {
  const { refresh, me } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (me) nav(sp.get('next') || '/', { replace: true }); }, [me]); // eslint-disable-line
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await post('/auth/login', { email, password }); await refresh(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const faceId = async () => {
    setErr(''); setBusy(true);
    try { await loginWithPasskey(); await refresh(); }
    catch (e) { const m = passkeyError(e); if (m) setErr(m); } finally { setBusy(false); }
  };
  const canPasskey = passkeySupported();
  return (
    <Shell>
      <form className="card stack" onSubmit={submit}>
        <div><h2>Iniciar sesión</h2><p className="muted small">Entra con tu correo o tu teléfono.</p></div>
        {err && <Notice kind="danger">{err}</Notice>}
        {canPasskey && <>
          <button type="button" className="btn primary lg faceid-btn" onClick={faceId} disabled={busy}><ScanFace size={22} /> Entrar con {unlockName()}</button>
          <div className="or-sep"><span>o con contraseña</span></div>
        </>}
        <Field label="Correo o teléfono"><input className="input" name="usuario" type="text" inputMode="email" autoCapitalize="none" autoCorrect="off" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Contraseña"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <button className={`btn lg ${canPasskey ? '' : 'primary'}`} disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <div className="row between small"><Link className="muted" to="/recuperar">¿Has olvidado la contraseña?</Link><Link className="muted" to="/registro">Tengo una invitación</Link></div>
      </form>
    </Shell>
  );
}

export function Register() {
  const [sp] = useSearchParams();
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [code, setCode] = useState(sp.get('codigo') ?? '');
  const [inv, setInv] = useState<any>(null);
  const [f, setF] = useState({ name: '', email: '', password: '', password2: '' });
  const [err, setErr] = useState('');
  useEffect(() => {
    if (code.length < 6) { setInv(null); return; }
    get(`/auth/invitation/${encodeURIComponent(code)}`).then((i) => { setInv(i); setF((x) => ({ ...x, email: i.email ?? x.email, name: i.name ?? x.name })); setErr(''); }).catch((e) => { setInv(null); setErr(e.message); });
  }, [code]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (f.password !== f.password2) return setErr('Las contraseñas no coinciden.');
    try { await post('/auth/register', { code, name: f.name, email: f.email, password: f.password }); await refresh(); nav('/'); }
    catch (e) { setErr((e as Error).message); }
  };
  return (
    <Shell>
      <form className="card stack" onSubmit={submit}>
        <div><h2>Activar mi cuenta</h2><p className="muted small">El registro solo es posible con una invitación de la dirección.</p></div>
        {err && <Notice kind="danger">{err}</Notice>}
        <Field label="Código de invitación"><input className="input mono" value={code} onChange={(e) => setCode(e.target.value.trim())} required /></Field>
        {inv && <Notice kind="ok" title="Invitación válida">{inv.instrument ? `Asignación: ${inv.instrument}${inv.voice ? ` · ${inv.voice}` : ''}` : 'Completa tus datos.'}</Notice>}
        <Field label="Nombre y apellidos"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Correo electrónico"><input className="input" type="email" value={f.email} readOnly={!!inv?.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <Field label="Contraseña" hint="Mínimo 4 caracteres."><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
        <Field label="Repite la contraseña"><input className="input" type="password" autoComplete="new-password" value={f.password2} onChange={(e) => setF({ ...f, password2: e.target.value })} required /></Field>
        <button className="btn primary lg" disabled={!inv}>Activar cuenta</button>
        <Link className="muted small" to="/login">Volver</Link>
      </form>
    </Shell>
  );
}

/** Alta con el enlace que comparte la dirección: datos, instrumento y voz. */
export function Join() {
  const { code = '' } = useParams();
  const { refresh, me } = useAuth();
  const nav = useNavigate();
  const [inv, setInv] = useState<any>(null);
  const [loadErr, setLoadErr] = useState('');
  const [f, setF] = useState({ name: '', phone: '', email: '', password: '' });
  const [ins, setIns] = useState<number | null>(null);
  const [voice, setVoice] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get(`/auth/invitation/${encodeURIComponent(code)}`).then((i: any) => { if (!i.open) nav(`/registro?codigo=${encodeURIComponent(code)}`, { replace: true }); else setInv(i); })
      .catch((e) => setLoadErr((e as Error).message));
  }, [code]); // eslint-disable-line
  const instrument = inv?.instruments?.find((i: any) => i.id === ins);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    if (!ins) return setErr('Elige tu instrumento.');
    if (instrument?.voices.length && !voice) return setErr('Elige tu voz.');
    setBusy(true);
    try { await post('/auth/join', { code, name: f.name, phone: f.phone, email: f.email, password: f.password, instrument_id: ins, voice_id: voice }); await refresh(); nav('/', { replace: true }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  if (me) return <Shell><div className="card stack"><h2>Ya tienes la sesión iniciada</h2><p className="muted">Estás dentro como {me.name}.</p><Link className="btn primary lg" to="/">Ir al inicio</Link></div></Shell>;
  if (loadErr) return <Shell><div className="card stack"><h2>Enlace no válido</h2><Notice kind="danger">{loadErr}</Notice><Link className="btn" to="/login">Ya tengo cuenta</Link></div></Shell>;
  if (!inv) return <Shell><div className="card"><p className="muted">Cargando…</p></div></Shell>;
  return (
    <Shell>
      <form className="card stack join-form" onSubmit={submit}>
        <div><h2>Completa tu perfil</h2><p className="muted small">Pon tus datos e indica el instrumento que tocas y estarás listo para empezar.</p></div>
        <Field label="Nombre y apellidos"><input className="input" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></Field>
        <Field label="Correo" hint="Aquí te llegan los avisos de ensayos y actuaciones."><input className="input" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
        <Field label="Contraseña" hint="La que quieras (mínimo 4). Luego podrás entrar con Face ID."><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={4} /></Field>
        <Field label="Teléfono (opcional)" hint="Para entrar también con tu número."><input className="input" type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <div className="join-label">¿Qué tocas?</div>
        <div className="ins-grid">
          {inv.instruments.map((i: any) => (
            <button type="button" key={i.id} className={`ins-card ${ins === i.id ? 'on' : ''}`} aria-pressed={ins === i.id} onClick={() => { setIns(i.id); setVoice(null); }}>
              <span className="ins-ico"><InstrumentIcon name={i.name} size={52} /></span><span>{i.name}</span>
            </button>
          ))}
        </div>
        {instrument && instrument.voices.length > 0 && <>
          <div className="join-label">¿Qué voz de {instrument.name.toLowerCase()}?</div>
          <div className="voice-row">
            {instrument.voices.map((v: any) => <button type="button" key={v.id} className={`voice-chip ${voice === v.id ? 'on' : ''}`} aria-pressed={voice === v.id} onClick={() => setVoice(v.id)}>{v.name}</button>)}
          </div>
        </>}
        {err && <Notice kind="danger">{err}</Notice>}
        <button className="btn primary lg" disabled={busy}>{busy ? 'Creando tu cuenta…' : 'Hecho'}</button>
        <Link className="muted small" to="/login">Ya tengo cuenta</Link>
      </form>
    </Shell>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  return (
    <Shell>
      <form className="card stack" onSubmit={async (e) => { e.preventDefault(); try { const r = await post('/auth/forgot', { email }); setMsg(r.message); } catch (e) { setErr((e as Error).message); } }}>
        <h2>Recuperar contraseña</h2>
        {msg ? <Notice kind="ok">{msg}</Notice> : <>
          {err && <Notice kind="danger">{err}</Notice>}
          <Field label="Correo electrónico"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <button className="btn primary lg">Enviar enlace</button>
        </>}
        <Link className="muted small" to="/login">Volver</Link>
      </form>
    </Shell>
  );
}

export function Reset() {
  const { token } = useParams();
  const nav = useNavigate();
  const [p, setP] = useState(''); const [p2, setP2] = useState('');
  const [err, setErr] = useState(''); const [ok, setOk] = useState(false);
  return (
    <Shell>
      <form className="card stack" onSubmit={async (e) => { e.preventDefault(); setErr(''); if (p !== p2) return setErr('Las contraseñas no coinciden.'); try { await post('/auth/reset', { token, password: p }); setOk(true); setTimeout(() => nav('/login'), 1500); } catch (e) { setErr((e as Error).message); } }}>
        <h2>Nueva contraseña</h2>
        {ok ? <Notice kind="ok">Contraseña cambiada. Ya puedes iniciar sesión.</Notice> : <>
          {err && <Notice kind="danger">{err}</Notice>}
          <Field label="Nueva contraseña" hint="Mínimo 4 caracteres."><input className="input" type="password" autoComplete="new-password" value={p} onChange={(e) => setP(e.target.value)} required /></Field>
          <Field label="Repite la contraseña"><input className="input" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} required /></Field>
          <button className="btn primary lg">Guardar</button>
        </>}
      </form>
    </Shell>
  );
}
