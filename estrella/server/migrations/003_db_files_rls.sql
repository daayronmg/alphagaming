-- Archivos guardados dentro de la base de datos (para alojamientos gratuitos sin disco persistente)
alter table files add column if not exists data bytea;

-- En Supabase, el esquema public se expone por la API REST con la clave pública (anon).
-- Se activa RLS sin políticas en todas las tablas: nadie accede por esa vía.
-- El servidor de ESTRELLA se conecta como propietario de las tablas y no se ve afectado.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
