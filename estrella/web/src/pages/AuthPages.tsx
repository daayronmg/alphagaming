import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field, Notice } from '../components/ui';

function Shell({ children }: { children: ReactNode }) {
  const { branding } = useAuth();
  return (
    <div className="auth-shell">
      <div className="auth-art">
        <div className="staff-lines" />
        <div style={{ position: 'relative' }}>
          <div className="brand-mark" style={{ width: 64, height: 64, fontSize: 34, marginBottom: 22 }}>{branding.logoFileId ? <img src="/api/files/logo" alt="Logotipo de la banda" /> : (branding.appName ?? 'E')[0]}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.4rem, 5vw, 4rem)', fontWeight: 700, letterSpacing: '.12em', lineHeight: 1 }}>{branding.appName}</div>
          <p style={{ marginTop: 12, opacity: .8, maxWidth: 440 }}>{branding.bandName}</p>
          <p style={{ marginTop: 6, opacity: .55, fontSize: '.85rem' }}>Ensayos, partituras, dirección en directo y academia. Acceso privado para componentes.</p>
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
  return (
    <Shell>
      <form className="card stack" onSubmit={submit}>
        <div><h2>Iniciar sesión</h2><p className="muted small">Usa la cuenta que te ha facilitado la dirección.</p></div>
        {err && <Notice kind="danger">{err}</Notice>}
        <Field label="Correo electrónico"><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Contraseña"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <button className="btn primary lg" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
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
        <Field label="Contraseña" hint="Mínimo 10 caracteres, con letras y números."><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
        <Field label="Repite la contraseña"><input className="input" type="password" autoComplete="new-password" value={f.password2} onChange={(e) => setF({ ...f, password2: e.target.value })} required /></Field>
        <button className="btn primary lg" disabled={!inv}>Activar cuenta</button>
        <Link className="muted small" to="/login">Volver</Link>
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
          <Field label="Nueva contraseña" hint="Mínimo 10 caracteres, con letras y números."><input className="input" type="password" autoComplete="new-password" value={p} onChange={(e) => setP(e.target.value)} required /></Field>
          <Field label="Repite la contraseña"><input className="input" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} required /></Field>
          <button className="btn primary lg">Guardar</button>
        </>}
      </form>
    </Shell>
  );
}
