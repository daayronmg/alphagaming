import { Router } from 'express';
import { z } from 'zod';
import { q, one } from '../db.ts';
import { h, parse, HttpError } from '../lib/http.ts';
import { requireAuth, can, isStaff } from '../lib/auth.ts';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

inventoryRouter.get('/', h(async (req, res) => {
  const all = isStaff(req.user) || can(req.user, 'members.manage');
  res.json(await q(`select it.*, u.name as assigned_name from inventory_items it left join users u on u.id = it.assigned_to
    where $1 or it.assigned_to = $2 order by it.kind, it.name, it.code`, [all, req.user!.id]));
}));
const body = z.object({ kind: z.enum(['instrumento', 'uniforme', 'material']), name: z.string().min(1).max(120), code: z.string().max(60).nullable().optional(),
  size: z.string().max(30).nullable().optional(), condition: z.enum(['nuevo', 'bueno', 'regular', 'reparacion', 'baja']).default('bueno'),
  assigned_to: z.string().uuid().nullable().optional(), notes: z.string().max(1000).nullable().optional() });
inventoryRouter.post('/', h(async (req, res) => {
  if (!can(req.user, 'members.manage')) throw new HttpError(403, 'Sin permiso.');
  const b = parse(body, req.body);
  res.json(await one('insert into inventory_items(kind, name, code, size, condition, assigned_to, notes) values ($1,$2,$3,$4,$5,$6,$7) returning *', [b.kind, b.name, b.code ?? null, b.size ?? null, b.condition, b.assigned_to ?? null, b.notes ?? null]));
}));
inventoryRouter.put('/:id', h(async (req, res) => {
  if (!can(req.user, 'members.manage')) throw new HttpError(403, 'Sin permiso.');
  const b = parse(body, req.body);
  await q('update inventory_items set kind=$2, name=$3, code=$4, size=$5, condition=$6, assigned_to=$7, notes=$8, updated_at=now() where id=$1', [req.params.id, b.kind, b.name, b.code ?? null, b.size ?? null, b.condition, b.assigned_to ?? null, b.notes ?? null]);
  res.json({ ok: true });
}));
inventoryRouter.delete('/:id', h(async (req, res) => {
  if (!can(req.user, 'members.manage')) throw new HttpError(403, 'Sin permiso.');
  await q('delete from inventory_items where id = $1', [req.params.id]);
  res.json({ ok: true });
}));
