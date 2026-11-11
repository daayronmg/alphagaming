// Entrar con Face ID / Touch ID / huella (passkeys)
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { get, post } from './api';

export const passkeySupported = () => { try { return browserSupportsWebAuthn(); } catch { return false; } };

/** Nombre del método de desbloqueo según el dispositivo, para los textos. */
export function unlockName(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) return 'Face ID';
  if (/Macintosh/.test(ua)) return 'Touch ID';
  if (/Android/.test(ua)) return 'tu huella';
  if (/Windows/.test(ua)) return 'Windows Hello';
  return 'huella o Face ID';
}
function deviceName(): string {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Este dispositivo';
}

export async function addPasskey() {
  const { options, challengeId } = await post('/auth/passkey/register/options');
  const response = await startRegistration({ optionsJSON: options });
  await post('/auth/passkey/register/verify', { challengeId, response, device: deviceName() });
  try { localStorage.setItem('estrella.passkey', '1'); } catch { /* sin almacenamiento */ }
}

export async function loginWithPasskey() {
  const { options, challengeId } = await post('/auth/passkey/login/options');
  const response = await startAuthentication({ optionsJSON: options });
  await post('/auth/passkey/login/verify', { challengeId, response });
}

export const myPasskeys = () => get<any[]>('/auth/passkey');

/** ¿Merece la pena ofrecer activar Face ID? (soportado, no lo tiene y no lo ha rechazado) */
export async function shouldOfferPasskey(): Promise<boolean> {
  if (!passkeySupported()) return false;
  try { if (localStorage.getItem('estrella.passkey.no') === '1') return false; } catch { /* nada */ }
  try { return (await myPasskeys()).length === 0; } catch { return false; }
}
export const declinePasskey = () => { try { localStorage.setItem('estrella.passkey.no', '1'); } catch { /* nada */ } };

/** Mensaje claro cuando el usuario cancela o el navegador no deja. */
export function passkeyError(e: unknown): string | null {
  const n = (e as any)?.name;
  if (n === 'NotAllowedError' || n === 'AbortError') return null; // canceló
  return (e as Error)?.message || 'No se pudo usar Face ID.';
}
