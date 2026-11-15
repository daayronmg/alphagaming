// Pantalla completa en todos los dispositivos: API estándar, la de Safari (iPad) y, donde no existe
// (iPhone), un «modo foco» que oculta todo lo demás y ocupa la pantalla entera.
type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

const doc = () => document as FsDoc;
export const nativeFullscreen = () => typeof document !== 'undefined' && !!(document.documentElement.requestFullscreen || (document.documentElement as FsEl).webkitRequestFullscreen);
export const isFullscreen = () => !!(doc().fullscreenElement || doc().webkitFullscreenElement || document.documentElement.classList.contains('pseudo-full'));

const listeners = new Set<() => void>();
const fire = () => listeners.forEach((l) => l());
if (typeof document !== 'undefined') { document.addEventListener('fullscreenchange', fire); document.addEventListener('webkitfullscreenchange', fire); }
export function onFullscreen(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

export async function toggleFullscreen(el: HTMLElement = document.documentElement) {
  const d = doc();
  if (d.fullscreenElement || d.webkitFullscreenElement) {
    try { await (d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.()); } catch { /* ya salió */ }
    return;
  }
  if (document.documentElement.classList.contains('pseudo-full')) { document.documentElement.classList.remove('pseudo-full'); fire(); return; }
  const e = el as FsEl;
  try {
    if (e.requestFullscreen) await e.requestFullscreen();
    else if (e.webkitRequestFullscreen) await e.webkitRequestFullscreen();
    else throw new Error('sin API');
  } catch {
    // sin pantalla completa del navegador: se ocultan cabecera, menú y barras de la app
    document.documentElement.classList.add('pseudo-full'); fire();
  }
}
