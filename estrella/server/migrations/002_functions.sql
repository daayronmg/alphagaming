create or replace function unaccent_lower(t text) returns text language sql immutable as $$
  select lower(translate(coalesce(t, ''), 'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇáàäâéèëêíìïîóòöôúùüûñç', 'AAAAEEEEIIIIOOOOUUUUNCaaaaeeeeiiiioooouuuunc'))
$$;
