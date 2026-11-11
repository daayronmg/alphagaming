/**
 * Marchas privadas: una marcha con `owner_id` solo existe para su dueño. Para el resto —también la dirección—
 * cualquier acceso por identificador (marcha, parte, partitura editable, archivo, grabación) responde 404,
 * y las listas las excluyen en sus consultas. Este filtro cubre todos los accesos por identificador de una vez.
 */
import type { Request, Response, NextFunction } from 'express';
import { one } from '../db.ts';

const U = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const BY = {
  marcha: 'select owner_id from marchas where id = $1',
  part: 'select m.owner_id from parts p join marchas m on m.id = p.marcha_id where p.id = $1',
  score: 'select m.owner_id from scores s join marchas m on m.id = s.marcha_id where s.id = $1',
  recording: 'select m.owner_id from recordings r join marchas m on m.id = r.marcha_id where r.id = $1',
  file: `select m.owner_id from marchas m where m.owner_id is not null and (
      exists (select 1 from parts p where p.marcha_id = m.id and p.file_id = $1)
      or exists (select 1 from recordings r where r.marcha_id = m.id and r.file_id = $1)
      or exists (select 1 from scores s where s.marcha_id = m.id and s.source_file_id = $1)) limit 1`,
} as const;
const PATHS: [RegExp, keyof typeof BY][] = [
  [new RegExp(`^/library/(?:private/)?marchas/${U}`, 'i'), 'marcha'],
  [new RegExp(`^/library/parts/${U}`, 'i'), 'part'],
  [new RegExp(`^/library/recordings/${U}`, 'i'), 'recording'],
  [new RegExp(`^/scores/(?:pdf|omr)/${U}`, 'i'), 'part'],
  [new RegExp(`^/scores/source/${U}`, 'i'), 'file'],
  [new RegExp(`^/scores/${U}`, 'i'), 'score'],
  [new RegExp(`^/files/${U}`, 'i'), 'file'],
];
const FIELDS: [string, keyof typeof BY][] = [['marcha', 'marcha'], ['marcha_id', 'marcha'], ['marchaId', 'marcha'], ['part', 'part'], ['part_id', 'part'], ['partId', 'part'], ['score_id', 'score']];
const isUuid = (v: unknown): v is string => typeof v === 'string' && new RegExp(`^${U}$`, 'i').test(v);

// mientras nadie tenga marchas privadas no se consulta nada (se comprueba cada pocos segundos)
let any = { at: 0, v: false };
export function privateMarchasChanged() { any = { at: 0, v: true }; }
async function anyPrivate() {
  if (Date.now() - any.at < 15_000) return any.v;
  any = { at: Date.now(), v: !!(await one('select 1 from marchas where owner_id is not null limit 1')) };
  return any.v;
}

/** Dueño de la marcha a la que pertenece ese identificador, o null si es de la banda. */
export async function ownerOf(kind: keyof typeof BY, id: string): Promise<string | null> {
  return (await one<any>(BY[kind], [id]))?.owner_id ?? null;
}

export async function privacyGuard(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user || !(await anyPrivate())) return next();
    const checks: [keyof typeof BY, string][] = [];
    for (const [re, kind] of PATHS) { const m = re.exec(req.path); if (m) { checks.push([kind, m[1]]); break; } }
    for (const [f, kind] of FIELDS) for (const src of [req.query, req.body]) { const v = (src as any)?.[f]; if (isUuid(v)) checks.push([kind, v]); }
    for (const [kind, id] of checks) {
      const owner = await ownerOf(kind, id);
      if (owner && owner !== req.user.id) return res.status(404).json({ error: 'No encontrado.' });
    }
    next();
  } catch (e) { next(e); }
}
