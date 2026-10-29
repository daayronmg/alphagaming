import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { X, Inbox, AlertTriangle, CheckCircle2, Info, Siren } from 'lucide-react';

export function Modal({ title, onClose, children, wide, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head"><h2>{title}</h2><button className="btn icon ghost" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></div>
        {children}
        {footer && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return <div className="empty">{icon ?? <Inbox size={36} />}<h3 style={{ marginBottom: 6 }}>{title}</h3>{children && <div className="small">{children}</div>}</div>;
}

export function Spinner({ label }: { label?: string }) {
  return <div className="row" style={{ justifyContent: 'center', padding: 30 }}><div className="spinner" />{label && <span className="muted small">{label}</span>}</div>;
}

export function Notice({ kind = 'info', children, title }: { kind?: 'info' | 'warn' | 'danger' | 'ok'; children?: ReactNode; title?: ReactNode }) {
  const I = kind === 'warn' ? AlertTriangle : kind === 'danger' ? Siren : kind === 'ok' ? CheckCircle2 : Info;
  return <div className={`notice ${kind}`}><I size={20} style={{ flex: 'none', marginTop: 1 }} /><div className="stack sm grow">{title && <strong>{title}</strong>}{children && <div className="small">{children}</div>}</div></div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small className="faint">{hint}</small>}</label>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return <div className="tabs" role="tablist">{items.map((i) => <button key={i.value} role="tab" aria-selected={value === i.value} className={value === i.value ? 'active' : ''} onClick={() => onChange(i.value)}>{i.label}</button>)}</div>;
}

// ===== Avisos emergentes =====
type Toast = { id: number; kind: 'info' | 'ok' | 'error' | 'urgent'; text: ReactNode; title?: string };
const ToastCtx = createContext<(t: Omit<Toast, 'id'> & { ms?: number }) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'> & { ms?: number }) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-3), { ...t, id }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), t.ms ?? (t.kind === 'urgent' ? 12000 : 4500));
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => setList((l) => l.filter((x) => x.id !== t.id))}>
            {t.kind === 'urgent' ? <Siren size={18} /> : t.kind === 'error' ? <AlertTriangle size={18} /> : t.kind === 'ok' ? <CheckCircle2 size={18} /> : <Info size={18} />}
            <div className="stack sm">{t.title && <strong>{t.title}</strong>}<div className="small">{t.text}</div></div>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Hook de carga de datos con recarga. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: string | null; loading: boolean; reload: () => Promise<void>; setData: (d: T) => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try { setError(null); setData(await fn()); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setLoading(true); reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return <Notice kind="danger" title="No se ha podido cargar">{error}{retry && <div style={{ marginTop: 8 }}><button className="btn sm" onClick={retry}>Reintentar</button></div>}</Notice>;
}

export function Confirm({ text, onYes, onClose, danger, yes = 'Confirmar' }: { text: ReactNode; onYes: () => void; onClose: () => void; danger?: boolean; yes?: string }) {
  return <Modal title="Confirmar" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={() => { onYes(); onClose(); }}>{yes}</button></>}><p>{text}</p></Modal>;
}
