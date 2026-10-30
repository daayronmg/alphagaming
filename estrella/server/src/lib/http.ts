import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z, ZodError } from 'zod';
import { HttpError } from './files.ts';

export { HttpError };
export const h = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'Datos no válidos: ' + r.error.issues.map((i) => `${i.path.join('.') || 'cuerpo'}: ${i.message}`).join('; '));
  return r.data;
}
export const uuid = z.string().uuid();

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError) return res.status(400).json({ error: 'Datos no válidos' });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'El archivo supera el tamaño máximo permitido.' });
  if (err?.code === '23505') return res.status(409).json({ error: 'Ya existe un registro con esos datos.' });
  if (err?.code === '23503') return res.status(409).json({ error: 'El registro está en uso o hace referencia a datos inexistentes.' });
  if (err?.code === '22P02') return res.status(400).json({ error: 'Identificador no válido.' });
  console.error('[error]', err);
  res.status(500).json({ error: 'Error interno del servidor.' });
}
