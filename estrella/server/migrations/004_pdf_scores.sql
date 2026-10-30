-- Notas obtenidas automáticamente de las partituras PDF (transcripción revisable)
alter table scores drop constraint if exists scores_source_check;
alter table scores add constraint scores_source_check check (source in ('musicxml','manual','omr','pdf'));
alter table scores add column if not exists review_measures int[] not null default '{}';
