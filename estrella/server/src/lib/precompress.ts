/**
 * Archivos de la interfaz comprimidos de antemano (brotli y gzip). El servidor gratuito tiene muy poca CPU:
 * se comprimen una sola vez al arrancar, en segundo plano, y después se envían ya comprimidos.
 * Los móviles descargan unas 4–5 veces menos datos.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';

const br = promisify(zlib.brotliCompress);
const gz = promisify(zlib.gzip);
const COMPRESSIBLE = /\.(js|mjs|css|html|svg|json|webmanifest|txt)$/;
const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

export async function precompress(dist: string) {
  const files = walk(dist).filter((f) => COMPRESSIBLE.test(f) && fs.statSync(f).size > 1024);
  for (const f of files) {
    const buf = fs.readFileSync(f);
    if (!fs.existsSync(`${f}.br`)) fs.writeFileSync(`${f}.br`, await br(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }));
    if (!fs.existsSync(`${f}.gz`)) fs.writeFileSync(`${f}.gz`, await gz(buf, { level: 9 }));
  }
}

/** Sirve la versión comprimida si el navegador la acepta y ya existe. */
export function servePrecompressed(dist: string, cacheControl: (p: string) => string | null) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const ext = path.extname(req.path);
    if (!COMPRESSIBLE.test(req.path) || !TYPES[ext]) return next();
    const file = path.join(dist, path.normalize(req.path).replace(/^([/\\])+/, ''));
    if (!file.startsWith(dist)) return next();
    const accept = String(req.headers['accept-encoding'] || '');
    const pick = /\bbr\b/.test(accept) && fs.existsSync(`${file}.br`) ? 'br' : /\bgzip\b/.test(accept) && fs.existsSync(`${file}.gz`) ? 'gz' : null;
    if (!pick) return next();
    res.setHeader('Content-Type', TYPES[ext]);
    res.setHeader('Content-Encoding', pick === 'br' ? 'br' : 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    const cc = cacheControl(req.path);
    if (cc) res.setHeader('Cache-Control', cc);
    res.sendFile(`${file}.${pick}`, { headers: {} }, (err) => { if (err) next(err); });
  };
}
