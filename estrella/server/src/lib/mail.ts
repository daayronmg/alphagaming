import nodemailer from 'nodemailer';
import { config } from '../config.ts';

let transport: nodemailer.Transporter | null = null;

/** Envía un correo si SMTP_URL está configurado. Devuelve false si no hay servicio de correo. */
export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  if (!config.smtpUrl) return false;
  transport ??= nodemailer.createTransport(config.smtpUrl);
  try {
    await transport.sendMail({ from: config.mailFrom, to, subject, text, ...(html ? { html } : {}) });
    return true;
  } catch (e) {
    console.error('[correo] no se pudo enviar:', (e as Error).message);
    return false;
  }
}
