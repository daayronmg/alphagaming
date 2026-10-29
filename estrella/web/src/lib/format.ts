const tz = undefined; // zona horaria del dispositivo
export const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz });
export const fmtDateLong = (d: string | Date) => new Date(d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz });
export const fmtTime = (d: string | Date) => new Date(d).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: tz });
export const fmtDateTime = (d: string | Date) => `${fmtDate(d)} · ${fmtTime(d)}`;
export function fmtRelative(d: string | Date) {
  const diff = (new Date(d).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
export const EVENT_TYPES: Record<string, string> = { ensayo: 'Ensayo', actuacion: 'Actuación', concierto: 'Concierto', procesion: 'Procesión', otro: 'Otro' };
export const ATT_LABEL: Record<string, string> = { presente: 'Presente', ausente: 'Ausente', retraso: 'Retraso', justificada: 'Justificada', pendiente: 'Pendiente' };
export const toLocalInput = (d?: string | Date | null) => {
  if (!d) return '';
  const x = new Date(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
};
export const fromLocalInput = (s: string) => (s ? new Date(s).toISOString() : null);
export const assignmentLabel = (a: { instrument: string; voice?: string | null }) => `${a.instrument}${a.voice ? ` · ${a.voice}` : ''}`;
