-- Enlaces de invitación abiertos: la dirección comparte un enlace (p. ej. por WhatsApp) que caduca
-- cuando ella decide; cada persona que lo abre se da de alta eligiendo su instrumento y su voz.
alter table invitations add column if not exists open boolean not null default false;
alter table invitations add column if not exists uses int not null default 0;

-- Voces 1ª, 2ª y 3ª también para trompeta, trombón y bombardino (si existen y aún no tienen voces)
insert into voices(instrument_id, name, sort)
select i.id, v.name, v.sort
from instruments i
cross join (values ('1ª voz', 0), ('2ª voz', 1), ('3ª voz', 2)) as v(name, sort)
where i.name in ('Trompeta', 'Trombón', 'Bombardino')
  and not exists (select 1 from voices x where x.instrument_id = i.id)
on conflict do nothing;
