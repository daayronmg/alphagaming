-- Cambio entre modo dirección y modo músico: se guarda por sesión (cada dispositivo puede estar en un modo).
alter table sessions add column if not exists acting_member boolean not null default false;
-- Solo Dayron puede cambiar de modo (permiso «mode.switch»). En otras bases de datos no coincide con nadie.
update users set permissions = array_append(permissions, 'mode.switch')
where id = '521a3fe7-3477-4572-a4b5-52339c16d6d9' and not ('mode.switch' = any(permissions));
