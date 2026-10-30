import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config.ts';
import { one, q, type Db } from '../db.ts';
import type { AuthUser } from './auth.ts';
import { isStaff } from './auth.ts';

export type FileKind = 'pdf' | 'image' | 'audio' | 'musicxml' | 'document';

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });

/** Detección por contenido (bytes mágicos), no por la extensión que envía el cliente. */
export function sniff(buf: Buffer): { kind: FileKind; mime: string } | null {
  const h = (n: number) => buf.subarray(0, n).toString('hex');
  const ascii = (a: number, b: number) => buf.subarray(a, b).toString('latin1');
  if (ascii(0, 5) === '%PDF-') return { kind: 'pdf', mime: 'application/pdf' };
  if (h(8) === '89504e470d0a1a0a') return { kind: 'image', mime: 'image/png' };
  if (h(3) === 'ffd8ff') return { kind: 'image', mime: 'image/jpeg' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { kind: 'audio', mime: 'audio/wav' };
  if (ascii(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { kind: 'audio', mime: 'audio/mpeg' };
  if (ascii(0, 4) === 'OggS') return { kind: 'audio', mime: 'audio/ogg' };
  if (ascii(0, 4) === 'fLaC') return { kind: 'audio', mime: 'audio/flac' };
  if (h(4) === '1a45dfa3') return { kind: 'audio', mime: 'audio/webm' };
  if (ascii(4, 8) === 'ftyp') return { kind: 'audio', mime: 'audio/mp4' };
  const head = buf.subarray(0, 2000).toString('utf8').replace(/^﻿/, '').trimStart();
  if (head.startsWith('<') && /<score-partwise|<score-timewise|<!DOCTYPE score-partwise/.test(head)) return { kind: 'musicxml', mime: 'application/vnd.recordare.musicxml+xml' };
  if (ascii(0, 2) === 'PK') return { kind: 'document', mime: 'application/zip' };
  return null;
}

export async function storeFile(buf: Buffer, originalName: string, ownerId: string, allowed: FileKind[], db?: Db) {
  const s = sniff(buf);
  if (!s) throw new HttpError(415, 'Formato de archivo no reconocido o no admitido.');
  if (!allowed.includes(s.kind)) throw new HttpError(415, `Tipo de archivo no permitido aquí (${s.kind}). Se admite: ${allowed.join(', ')}.`);
  const id = crypto.randomUUID();
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const name = path.basename(originalName || 'archivo').slice(0, 180);
  let rel = 'db';
  if (config.storageMode === 'disk') {
    rel = path.join(id.slice(0, 2), id);
    const abs = path.join(config.storageDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf, { mode: 0o600 });
  }
  const row = await one<any>(
    'insert into files(id, owner_id, kind, mime, original_name, size, sha256, storage_path, data) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, kind, mime, original_name, size',
    [id, ownerId, s.kind, s.mime, name, buf.length, sha, rel, config.storageMode === 'db' ? buf : null], db,
  );
  return row as { id: string; kind: FileKind; mime: string; original_name: string; size: number };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** ¿Puede este usuario descargar este archivo? Los archivos son privados y se sirven solo tras comprobar su uso. */
export async function canAccessFile(user: AuthUser, fileId: string): Promise<boolean> {
  if (isStaff(user)) {
    // los responsables no acceden a documentos reservados de otras secciones, pero sí a material musical
    return true;
  }
  const f = await one<any>('select owner_id from files where id = $1', [fileId]);
  if (!f) return false;
  if (f.owner_id === user.id) return true;
  const musical = await one(`
    select 1 from parts where file_id = $1 union all
    select 1 from recordings where file_id = $1 union all
    select 1 from scores where source_file_id = $1 union all
    select 1 from lessons where source_material_id = $1 and status = 'publicado' union all
    select 1 from settings where key = 'branding' and value->>'logoFileId' = $1::text union all
    select 1 from users where photo_file_id = $1 limit 1`, [fileId]);
  if (musical) return true;
  const doc = await one<any>('select section_ids, restricted from documents where file_id = $1', [fileId]);
  if (doc && !doc.restricted && (doc.section_ids.length === 0 || doc.section_ids.some((s: number) => user.sectionIds.includes(s)))) return true;
  // Archivos de dudas: el autor o, si la duda es compartida, quien pueda verla
  const d = await one<any>(`
    select d.author_id, d.visibility, d.part_id from doubts d where d.crop_file_id = $1 or d.audio_file_id = $1
    union all
    select d.author_id, d.visibility, d.part_id from doubt_replies r join doubts d on d.id = r.doubt_id where r.audio_file_id = $1 or r.attachment_file_id = $1
    limit 1`, [fileId]);
  if (d) {
    if (d.author_id === user.id || d.visibility === 'band') return true;
    if (d.visibility === 'section') {
      const sec = await one<any>('select i.section_id from parts p join instruments i on i.id = p.instrument_id where p.id = $1', [d.part_id]);
      return !!sec && user.sectionIds.includes(sec.section_id);
    }
  }
  return false;
}

export function filePath(rel: string) {
  return path.join(config.storageDir, rel);
}

/** Contenido de un archivo, esté en disco o dentro de la base de datos. */
export async function readFileData(f: { id: string; storage_path: string }): Promise<Buffer> {
  if (f.storage_path === 'db') {
    const r = await one<any>('select data from files where id = $1', [f.id]);
    return r?.data ?? Buffer.alloc(0);
  }
  return fs.readFileSync(filePath(f.storage_path));
}

export async function fileRow(id: string) {
  return one<any>('select id, owner_id, kind, mime, original_name, size, sha256, storage_path, created_at from files where id = $1', [id]);
}

export async function deleteFileIfOrphan(id: string) {
  const used = await q(`select 1 from parts where file_id=$1 union all select 1 from recordings where file_id=$1 union all select 1 from documents where file_id=$1 limit 1`, [id]);
  if (used.length) return;
  const f = await fileRow(id);
  if (!f) return;
  try { await q('delete from files where id = $1', [id]); if (f.storage_path !== 'db') fs.rmSync(filePath(f.storage_path), { force: true }); } catch { /* referenciado por otra tabla */ }
}
