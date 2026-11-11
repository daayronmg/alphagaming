import { useEffect, type ReactNode } from 'react';

/** Hoja que sube desde abajo con opciones grandes (como en las apps de móvil). */
export function Sheet({ title, onClose, children, center }: { title: ReactNode; onClose: () => void; children: ReactNode; center?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden />
        <div className={`sheet-title ${center ? "center" : ""}`}>{title}</div>
        {children}
      </div>
    </div>
  );
}

export function SheetOption({ icon, title, text, badge, onClick }: { icon: ReactNode; title: string; text: string; badge?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="sheet-opt" onClick={onClick}>
      <span className="sheet-ico">{icon}</span>
      <span className="grow"><b>{title}</b>{badge && <span className="sheet-badge">{badge}</span>}<small>{text}</small></span>
    </button>
  );
}
