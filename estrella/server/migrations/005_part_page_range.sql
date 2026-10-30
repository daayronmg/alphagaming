-- Una parte puede ser un tramo de páginas de un libreto (un único PDF compartido por varias marchas)
alter table parts add column if not exists page_from int;
alter table parts add column if not exists page_to int;
