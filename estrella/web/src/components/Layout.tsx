import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import {
  Home, CalendarDays, Library, Radio, Megaphone, MessageCircleQuestion, GraduationCap, Bot, Users, BarChart3,
  Settings, Shield, Package, LogOut, Moon, Sun, Wifi, WifiOff, RefreshCw, Siren, CloudUpload, Menu, Baton,
} from './icons';
import { useAuth } from '../lib/auth';
import { rt, useConn, useRealtime } from '../lib/realtime';
import { get, post, fileUrl } from '../lib/api';
import { useToast, Modal } from './ui';
import { onOutbox, pending } from '../lib/offline';
import { initials } from '../lib/format';

export function useTheme(): ['dark' | 'light', () => void] {
  const [t, setT] = useState<'dark' | 'light'>(() => (localStorage.getItem('estrella.theme') as any) || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  useEffect(() => { document.documentElement.dataset.theme = t; localStorage.setItem('estrella.theme', t); }, [t]);
  return [t, () => setT((x) => (x === 'dark' ? 'light' : 'dark'))];
}

export function autoFollowEnabled() { return localStorage.getItem('estrella.autofollow') !== '0'; }

function ConnBadge() {
  const s = useConn();
  const [queued, setQueued] = useState(0);
  useEffect(() => { pending().then((p) => setQueued(p.length)); return onOutbox(setQueued); }, []);
  return (
    <div className="row" style={{ gap: 6 }} title={s === 'conectado' ? `Conectado · latencia ${Math.round(rt.rtt)} ms` : s}>
      {queued > 0 && <span className="badge warn"><CloudUpload size={13} /> {queued} pendiente{queued > 1 ? 's' : ''}</span>}
      <span className={`badge ${s === 'conectado' ? 'ok' : s === 'conectando' ? 'warn' : 'danger'}`} data-testid="conn-status">
        {s === 'conectado' ? <Wifi size={13} /> : s === 'conectando' ? <RefreshCw size={13} /> : <WifiOff size={13} />}
        <span className="hide-sm">{s === 'conectado' ? 'En línea' : s === 'conectando' ? 'Conectando' : 'Sin conexión'}</span>
      </span>
    </div>
  );
}

export default function Layout() {
  const { me, logout, can, canSection, isStaff, branding, prefs } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const toast = useToast();
  const nav = useNavigate();
  const loc = useLocation();
  const [urgent, setUrgent] = useState<any[]>([]);
  const [live, setLive] = useState<any | null>(null);
  const [doubtCount, setDoubtCount] = useState(0);
  const [unread, setUnread] = useState(0);
  const [more, setMore] = useState(false);
  const followed = useRef<string | null>(null);
  const director = can('live.direct');
  const manageDoubts = can('scores.publish') || canSection('doubts');

  const loadSide = async () => {
    try {
      const anns = await get<any[]>('/comms/announcements');
      setUrgent(anns.filter((a) => a.urgent && !a.read));
      setUnread(anns.filter((a) => !a.read).length);
    } catch { /* sin conexión */ }
    try {
      const l = await get<any[]>('/live/active');
      setLive(l[0] ?? null);
      if (l[0] && !director && autoFollowEnabled() && followed.current !== l[0].id && sessionStorage.getItem('estrella.followed') !== l[0].id && (loc.pathname === '/' || loc.pathname === '/directo')) {
        sessionStorage.setItem('estrella.followed', l[0].id);
        followed.current = l[0].id;
        nav(`/directo/${l[0].id}`);
      }
    } catch { /* */ }
    if (manageDoubts) get('/doubts/counts').then((c) => setDoubtCount(c.nueva + c.pendiente)).catch(() => {});
  };
  useEffect(() => { loadSide(); }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useRealtime((m) => {
    switch (m.t) {
      case 'announcement': {
        const a = m.announcement;
        if (a.urgent) { setUrgent((u) => [a, ...u.filter((x) => x.id !== a.id)]); toast({ kind: 'urgent', title: a.title, text: a.body }); navigator.vibrate?.([200, 100, 200]); }
        else if (!prefs.mute_non_urgent && localStorage.getItem('estrella.liveSilent') !== '1' && prefs.categories?.avisos !== false) toast({ kind: 'info', title: 'Nuevo aviso', text: a.title });
        setUnread((n) => n + 1);
        break;
      }
      case 'live:started':
        loadSide();
        if (!director && autoFollowEnabled() && followed.current !== m.sessionId) { followed.current = m.sessionId; sessionStorage.setItem('estrella.followed', m.sessionId); nav(`/directo/${m.sessionId}`); toast({ kind: 'info', title: 'Ensayo en directo', text: `${m.by} ha iniciado la sesión. Te llevamos a tu partitura.` }); }
        break;
      case 'live:ended': setLive(null); break;
      case 'doubt:new': if (manageDoubts) { setDoubtCount((n) => n + 1); if (!prefs.mute_non_urgent) toast({ kind: 'info', title: `Duda de ${m.doubt.author_name}`, text: `${m.doubt.marcha_title}: ${m.doubt.text}` }); } break;
      case 'doubt:reply': if (m.reply.author_id !== me?.id) toast({ kind: 'ok', title: 'Respuesta a tu duda', text: m.reply.text || 'Nueva respuesta (audio o dibujo)' }); break;
      case 'reconnected': loadSide(); break;
    }
  }, [prefs, director, manageDoubts, me?.id]);

  if (!me) return null;
  const appName = branding.appName ?? 'ESTRELLA';

  const links: { to: string; label: string; icon: ReactNode; show?: boolean; count?: number; group?: string }[] = [
    { to: '/', label: 'Inicio', icon: <Home size={19} /> },
    { to: '/calendario', label: 'Calendario', icon: <CalendarDays size={19} /> },
    { to: '/biblioteca', label: 'Biblioteca', icon: <Library size={19} /> },
    { to: live ? `/directo/${live.id}` : '/directo', label: 'Ensayo en directo', icon: <Radio size={19} />, count: live ? 1 : 0 },
    { to: '/avisos', label: 'Avisos', icon: <Megaphone size={19} />, count: unread },
    { to: '/dudas', label: manageDoubts ? 'Bandeja de dudas' : 'Mis dudas', icon: <MessageCircleQuestion size={19} />, count: manageDoubts ? doubtCount : 0 },
    { to: '/academia', label: 'Academia', icon: <GraduationCap size={19} /> },
    { to: '/asistente', label: 'Asistente', icon: <Bot size={19} /> },
    { to: '/direccion', label: 'Panel de dirección', icon: <Baton size={19} />, show: director, group: 'Dirección' },
    { to: '/componentes', label: 'Componentes', icon: <Users size={19} />, show: isStaff || can('members.manage'), group: 'Dirección' },
    { to: '/estadisticas', label: 'Estadísticas', icon: <BarChart3 size={19} />, show: can('stats.view') || canSection('attendance'), group: 'Dirección' },
    { to: '/inventario', label: 'Material y uniformidad', icon: <Package size={19} />, group: 'Dirección', show: isStaff },
    { to: '/admin', label: 'Administración', icon: <Shield size={19} />, show: me.role === 'director' || can('assignments.manage'), group: 'Dirección' },
    { to: '/ajustes', label: 'Mi cuenta', icon: <Settings size={19} />, group: 'Personal' },
  ];
  const visible = links.filter((l) => l.show !== false);
  let lastGroup: string | undefined;

  const ackUrgent = async (id: string) => {
    await post(`/comms/announcements/${id}/read`).catch(() => {});
    setUrgent((u) => u.filter((x) => x.id !== id));
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <div className="brand-mark">{branding.logoFileId ? <img src="/api/files/logo" alt="" /> : appName[0]}</div>
          <div><div className="brand-name">{appName}</div><div className="brand-sub">{branding.bandName}</div></div>
        </Link>
        {visible.map((l) => {
          const header = l.group && l.group !== lastGroup ? <div className="nav-group" key={`g-${l.group}`}>{l.group}</div> : null;
          lastGroup = l.group ?? lastGroup;
          return [header, (
            <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              {l.icon}<span>{l.label}</span>{!!l.count && <span className="count">{l.count}</span>}
            </NavLink>
          )];
        })}
        <div style={{ flex: 1 }} />
        <div className="list-item" style={{ padding: 8 }}>
          <div className="avatar">{me.photo_file_id ? <img src={fileUrl(me.photo_file_id)} alt="" /> : initials(me.name)}</div>
          <div className="grow"><div className="small ellipsis" style={{ fontWeight: 650 }}>{me.name}</div><div className="xs faint">{me.role === 'director' ? 'Dirección musical' : me.role === 'leader' ? 'Responsable' : 'Componente'}</div></div>
          <button className="btn icon ghost sm" onClick={async () => { await logout(); nav('/login'); }} title="Cerrar sesión" aria-label="Cerrar sesión"><LogOut size={16} /></button>
        </div>
      </aside>
      <div className="main">
        {urgent[0] && (
          <div className="urgent-banner" role="alert" data-testid="urgent-banner">
            <Siren size={20} />
            <div className="grow"><div>{urgent[0].title}</div><div className="small" style={{ fontWeight: 450, opacity: .9 }}>{urgent[0].body}</div></div>
            <button className="btn sm" onClick={() => ackUrgent(urgent[0].id)}>Leído</button>
          </div>
        )}
        {live && !loc.pathname.startsWith('/directo') && !loc.pathname.startsWith('/direccion') && (
          <div className="live-banner">
            <span className="dot-status on" /> <span className="grow">Ensayo en directo{live.event_title ? ` · ${live.event_title}` : ''}{live.state?.marchaTitle ? ` · ${live.state.marchaTitle}` : ''}</span>
            <Link className="btn sm primary" to={director ? `/direccion/${live.id}` : `/directo/${live.id}`}>{director ? 'Abrir consola' : 'Unirme'}</Link>
          </div>
        )}
        <header className="topbar">
          <button className="btn icon ghost show-sm" onClick={() => setMore(true)} aria-label="Menú"><Menu size={20} /></button>
          <div className="grow row" style={{ gap: 8 }}>
            <span className="show-sm brand-name" style={{ fontSize: '.95rem' }}>{appName}</span>
          </div>
          <ConnBadge />
          <button className="btn icon ghost" onClick={toggleTheme} aria-label="Cambiar tema" title="Modo claro/oscuro">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
        </header>
        <Outlet />
      </div>
      <nav className="bottom-nav">
        {[visible[0], visible[2], visible[3], visible[1]].map((l) => (
          <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>{l.icon}<span>{l.label.split(' ')[0]}</span>{!!l.count && l.label.startsWith('Ensayo') && <span className="dot" />}</NavLink>
        ))}
        <button onClick={() => setMore(true)}><Menu size={19} /><span>Más</span>{(unread > 0 || doubtCount > 0) && <span className="dot" />}</button>
      </nav>
      {more && (
        <Modal title={appName} onClose={() => setMore(false)}>
          <div className="stack sm">
            {visible.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.to === '/'} onClick={() => setMore(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>{l.icon}<span>{l.label}</span>{!!l.count && <span className="count">{l.count}</span>}</NavLink>
            ))}
            <div className="sep" />
            <button className="nav-link btn ghost" style={{ justifyContent: 'flex-start' }} onClick={async () => { await logout(); nav('/login'); }}><LogOut size={19} /> Cerrar sesión</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
