import { Router } from 'express';
import { requireAuth } from '../lib/auth.ts';
import { h, HttpError } from '../lib/http.ts';
import { canAccessFile, fileRow, filePath } from '../lib/files.ts';
import { one } from '../db.ts';

export const filesRouter = Router();

// El logotipo de la banda es público (se muestra en la pantalla de acceso)
filesRouter.get('/logo', h(async (_req, res) => {
  const b = await one<any>(`select value->>'logoFileId' as id from settings where key = 'branding'`);
  if (!b?.id) throw new HttpError(404, 'Sin logotipo configurado');
  const f = await fileRow(b.id);
  if (!f) throw new HttpError(404, 'Sin logotipo');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type(f.mime).sendFile(filePath(f.storage_path));
}));

filesRouter.get('/:id', requireAuth, h(async (req, res) => {
  const f = await fileRow(req.params.id);
  if (!f || !(await canAccessFile(req.user!, f.id))) throw new HttpError(404, 'Archivo no disponible.');
  // los archivos son inmutables (una nueva versión es un archivo nuevo): se pueden cachear sin conexión
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
  res.type(f.mime).sendFile(filePath(f.storage_path), { acceptRanges: true });
}));
