-- Las cornetas de la banda son de llaves Do/Reb y sus partes se escriben un semitono por encima de lo que suenan:
-- el Do# escrito es la posición de Do (|) y el Re escrito la de Reb (—). Comprobado con los libretos de la banda:
-- con −1 todas las notas escritas caen en notas que da la corneta; con −2 (corneta en Sib), solo una cuarta parte.
update instruments set transposition = -1 where name = 'Corneta' and transposition = -2;
-- partituras de la banda ya leídas o publicadas (las marchas privadas se dejan como están)
update score_versions sv set content = jsonb_set(sv.content, '{transposition}', '-1')
from scores s join instruments i on i.id = s.instrument_id join marchas m on m.id = s.marcha_id
where sv.score_id = s.id and i.name = 'Corneta' and m.owner_id is null and (sv.content->>'transposition')::int = -2;
update scores s set draft = jsonb_set(s.draft, '{transposition}', '-1')
from instruments i, marchas m
where i.id = s.instrument_id and m.id = s.marcha_id and i.name = 'Corneta' and m.owner_id is null
  and s.draft is not null and (s.draft->>'transposition')::int = -2;
