import { Router, type Response, type Request } from 'express';
import { requireAuth } from '../lib/auth.ts';
import { h, HttpError } from '../lib/http.ts';
import { canAccessFile, fileRow, filePath, readFileData } from '../lib/files.ts';
import { one } from '../db.ts';

export const filesRouter = Router();

/** Envía un archivo desde disco o desde la base de datos (con soporte de rangos para audio). */
async function sendStored(req: Request, res: Response, f: any) {
  if (f.storage_path !== 'db') return res.type(f.mime).sendFile(filePath(f.storage_path), { acceptRanges: true });
  const buf = await readFileData(f);
  res.type(f.mime);
  res.setHeader('Accept-Ranges', 'bytes');
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : buf.length - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : buf.length - 1;
    start = Math.max(0, start); end = Math.min(buf.length - 1, end);
    if (start > end) { res.status(416).setHeader('Content-Range', `bytes */${buf.length}`); return res.end(); }
    res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${buf.length}`);
    return res.end(buf.subarray(start, end + 1));
  }
  res.setHeader('Content-Length', String(buf.length));
  res.end(buf);
}

// El logotipo de la banda es público (se muestra en la pantalla de acceso)
filesRouter.get('/logo', h(async (req, res) => {
  const b = await one<any>(`select value->>'logoFileId' as id from settings where key = 'branding'`);
  if (!b?.id) throw new HttpError(404, 'Sin logotipo configurado');
  const f = await fileRow(b.id);
  if (!f) throw new HttpError(404, 'Sin logotipo');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  await sendStored(req, res, f);
}));

filesRouter.get('/:id', requireAuth, h(async (req, res) => {
  const f = await fileRow(req.params.id);
  if (!f || !(await canAccessFile(req.user!, f.id))) throw new HttpError(404, 'Archivo no disponible.');
  // los archivos son inmutables (una nueva versión es un archivo nuevo): se pueden cachear sin conexión
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);
  await sendStored(req, res, f);
}));
