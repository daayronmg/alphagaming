-- «Cómo se toca»: enlace a un vídeo o audio de referencia de la marcha
alter table marchas add column if not exists how_url text;
