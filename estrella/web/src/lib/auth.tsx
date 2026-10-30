import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { get, post } from './api';
import { rt, useRealtime } from './realtime';
import { APP_NAME_DEFAULT, BAND_NAME_DEFAULT } from '../config';

export interface Assignment { id: number; instrument_id: number; instrument: string; voice_id: number | null; voice: string | null; section_id: number; section: string; is_default: boolean; clef: string; transposition: number }
export interface Me {
  id: string; name: string; email: string; role: 'director' | 'leader' | 'member'; permissions: string[];
  leaderOf: { section_id: number; permissions: string[] }[]; sectionIds: number[]; assignments: Assignment[];
  phone: string | null; share_contact: boolean; photo_file_id: string | null;
}
export interface Prefs { mute_non_urgent: boolean; categories: Record<string, boolean> }
export interface Branding { appName?: string; bandName?: string; logoFileId?: string; accent?: string; instagram?: string }

interface Ctx {
  me: Me | null; prefs: Prefs; loading: boolean; branding: Branding;
  catalog: { global: Record<string, string>; section: Record<string, string> };
  refresh: () => Promise<void>; logout: () => Promise<void>;
  can: (perm: string, sectionId?: number | null) => boolean;
  canSection: (perm: string) => boolean;
  isStaff: boolean;
  setPrefs: (p: Prefs) => void;
}
const AuthCtx = createContext<Ctx>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({ mute_non_urgent: false, categories: {} });
  const [catalog, setCatalog] = useState<Ctx['catalog']>({ global: {}, section: {} });
  const [branding, setBranding] = useState<Branding>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await get('/auth/me');
      setMe(r.user);
      if (r.prefs) setPrefs(r.prefs);
      if (r.catalog) setCatalog(r.catalog);
      if (r.user) rt.start(); else rt.stop();
    } catch {
      // sin conexión: se mantiene la sesión anterior si existía (modo sin conexión)
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    get('/org/branding').then(setBranding).catch(() => {});
  }, [refresh]);

  useRealtime((m) => {
    if (m.t === 'me:changed') refresh();
    if (m.t === 'branding') setBranding(m.value);
  }, [refresh]);

  useEffect(() => {
    document.title = branding.appName || APP_NAME_DEFAULT;
    if (branding.accent) document.documentElement.style.setProperty('--accent', branding.accent);
  }, [branding]);

  const can = useCallback((perm: string, sectionId?: number | null) => {
    if (!me) return false;
    if (me.role === 'director' || me.permissions.includes(perm)) return true;
    if (sectionId != null) return me.leaderOf.some((l) => l.section_id === sectionId && l.permissions.includes(perm));
    return false;
  }, [me]);
  const canSection = useCallback((perm: string) => !!me && (me.role === 'director' || me.leaderOf.some((l) => l.permissions.includes(perm))), [me]);

  const logout = async () => { await post('/auth/logout').catch(() => {}); setMe(null); rt.stop(); };

  return (
    <AuthCtx.Provider value={{ me, prefs, loading, catalog, refresh, logout, can, canSection, isStaff: me?.role === 'director' || me?.role === 'leader', setPrefs,
      branding: { appName: branding.appName || APP_NAME_DEFAULT, bandName: branding.bandName || BAND_NAME_DEFAULT, ...branding } }}>
      {children}
    </AuthCtx.Provider>
  );
}
export const useAuth = () => useContext(AuthCtx);
