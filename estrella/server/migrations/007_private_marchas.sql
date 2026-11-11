-- Marchas privadas: las sube un componente con permiso «library.private» y solo las ve él
alter table marchas add column if not exists owner_id uuid references users(id) on delete cascade;
create index if not exists marchas_owner_idx on marchas(owner_id) where owner_id is not null;
