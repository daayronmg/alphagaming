-- ESTRELLA · esquema inicial
create extension if not exists pgcrypto;

create table settings (
  key text primary key,
  value jsonb not null
);

-- ===== Estructura de la banda (configurable por la dirección) =====
create table sections (
  id serial primary key,
  name text not null unique,
  family text not null default 'viento' check (family in ('viento','percusion','otro')),
  color text not null default '#c9a227',
  sort int not null default 0
);

create table instruments (
  id serial primary key,
  section_id int not null references sections(id) on delete cascade,
  name text not null,
  clef text not null default 'treble' check (clef in ('treble','bass','percussion')),
  -- semitonos entre lo escrito y lo que suena (corneta en Sib: -2)
  transposition int not null default 0,
  sort int not null default 0,
  unique (section_id, name)
);

create table voices (
  id serial primary key,
  instrument_id int not null references instruments(id) on delete cascade,
  name text not null,
  sort int not null default 0,
  unique (instrument_id, name)
);

-- ===== Usuarios =====
create table files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  kind text not null check (kind in ('pdf','image','audio','musicxml','document')),
  mime text not null,
  original_name text not null,
  size bigint not null,
  sha256 text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  name text not null,
  role text not null default 'member' check (role in ('director','leader','member')),
  status text not null default 'active' check (status in ('active','inactive','baja')),
  permissions text[] not null default '{}',
  joined_at date,
  photo_file_id uuid references files(id) on delete set null,
  phone text,
  share_contact boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  left_at date
);
alter table files add constraint files_owner_fk foreign key (owner_id) references users(id) on delete set null;

create table user_private_notes (
  user_id uuid primary key references users(id) on delete cascade,
  notes text not null default '',
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Asignación musical oficial: un componente puede tener varias (una por defecto)
create table user_assignments (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  instrument_id int not null references instruments(id) on delete cascade,
  voice_id int references voices(id) on delete set null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, instrument_id, voice_id)
);
create unique index user_assignments_one_default on user_assignments(user_id) where is_default;

-- Cambios de asignación: se registran y se aplican al confirmarlos o en la fecha indicada
create table assignment_changes (
  id serial primary key,
  user_id uuid not null references users(id) on delete cascade,
  before jsonb not null,
  after jsonb not null,
  status text not null default 'pendiente' check (status in ('pendiente','aplicado','cancelado')),
  effective_from date,
  reason text,
  requested_by uuid references users(id) on delete set null,
  applied_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

-- Responsables de sección y permisos que les concede la dirección
create table section_leaders (
  user_id uuid not null references users(id) on delete cascade,
  section_id int not null references sections(id) on delete cascade,
  permissions text[] not null default '{attendance,members,announce}',
  primary key (user_id, section_id)
);

create table sessions (
  id text primary key, -- sha256 del token
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text
);
create index on sessions(user_id);

create table invitations (
  code text primary key,
  email text,
  name text,
  role text not null default 'member' check (role in ('director','leader','member')),
  instrument_id int references instruments(id) on delete set null,
  voice_id int references voices(id) on delete set null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_by uuid references users(id) on delete set null,
  used_at timestamptz
);

create table password_resets (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references users(id) on delete set null
);

create table notification_prefs (
  user_id uuid primary key references users(id) on delete cascade,
  mute_non_urgent boolean not null default false,
  categories jsonb not null default '{"avisos":true,"eventos":true,"dudas":true,"partituras":true}'
);

-- ===== Biblioteca =====
create table folders (
  id serial primary key,
  name text not null,
  parent_id int references folders(id) on delete cascade
);

create table marchas (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  composer text,
  year int,
  duration_sec int,
  march_type text,
  instrumentation text,
  measures int,
  director_notes text,
  difficulty int check (difficulty between 1 and 5),
  folder_id int references folders(id) on delete set null,
  last_reviewed_at date,
  is_demo boolean not null default false,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tags (id serial primary key, name text not null unique);
create table marcha_tags (
  marcha_id uuid references marchas(id) on delete cascade,
  tag_id int references tags(id) on delete cascade,
  primary key (marcha_id, tag_id)
);
create table favorites (
  user_id uuid references users(id) on delete cascade,
  marcha_id uuid references marchas(id) on delete cascade,
  primary key (user_id, marcha_id)
);
create table marcha_changes (
  id serial primary key,
  marcha_id uuid not null references marchas(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  at timestamptz not null default now(),
  summary text not null,
  diff jsonb
);

-- Partitura visual (PDF / imagen) de una voz concreta o general
create table parts (
  id uuid primary key default gen_random_uuid(),
  marcha_id uuid not null references marchas(id) on delete cascade,
  instrument_id int references instruments(id) on delete set null,
  voice_id int references voices(id) on delete set null,
  label text not null,
  arrangement text,
  file_id uuid not null references files(id),
  page_count int,
  version int not null default 1,
  active boolean not null default true,
  replaces_part_id uuid references parts(id) on delete set null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Mapa de compases sobre el PDF de cada parte (vinculación manual).
-- Permite llevar a cada músico al mismo compás en su propia parte aunque la página difiera.
create table part_measures (
  part_id uuid not null references parts(id) on delete cascade,
  measure int not null,
  page int not null,
  x real not null, y real not null, w real not null, h real not null,
  primary key (part_id, measure)
);

create table recordings (
  id uuid primary key default gen_random_uuid(),
  marcha_id uuid not null references marchas(id) on delete cascade,
  instrument_id int references instruments(id) on delete set null,
  voice_id int references voices(id) on delete set null,
  label text not null,
  kind text not null default 'banda' check (kind in ('banda','pista','referencia')),
  file_id uuid not null references files(id),
  created_at timestamptz not null default now()
);

-- Partitura musical editable (modo B)
create table scores (
  id uuid primary key default gen_random_uuid(),
  marcha_id uuid not null references marchas(id) on delete cascade,
  instrument_id int references instruments(id) on delete set null,
  voice_id int references voices(id) on delete set null,
  part_id uuid references parts(id) on delete set null, -- PDF original de referencia
  label text not null,
  source text not null default 'manual' check (source in ('musicxml','manual','omr')),
  source_file_id uuid references files(id),
  needs_review boolean not null default false,
  published_version_id uuid,
  draft jsonb,
  draft_rev int not null default 0,
  draft_updated_by uuid references users(id) on delete set null,
  draft_updated_at timestamptz,
  created_at timestamptz not null default now()
);

create table score_versions (
  id uuid primary key default gen_random_uuid(),
  score_id uuid not null references scores(id) on delete cascade,
  number int not null,
  content jsonb not null,
  author_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  description text not null,
  changes jsonb not null default '[]',
  parent_version_id uuid references score_versions(id) on delete set null,
  restored_from uuid references score_versions(id) on delete set null,
  unique (score_id, number)
);
alter table scores add constraint scores_published_fk foreign key (published_version_id) references score_versions(id) on delete set null;

-- ===== Capas de anotación =====
-- Dos anclajes posibles:
--  · part_id + page: dibujo sobre la página de una parte concreta (coordenadas normalizadas 0..1)
--  · part_id nulo + measure: indicación de compás para toda la marcha; cada músico la ve en su propia parte
create table annotations (
  id uuid primary key,
  marcha_id uuid not null references marchas(id) on delete cascade,
  part_id uuid references parts(id) on delete cascade,
  score_id uuid references scores(id) on delete cascade,
  page int,
  layer text not null check (layer in ('official','personal')),
  owner_id uuid not null references users(id) on delete cascade,
  -- público de una anotación oficial: {"scope":"all"} o {"scope":"sections","sections":[1,2]}
  audience jsonb not null default '{"scope":"all"}',
  kind text not null check (kind in ('pen','highlighter','text','rect','circle','arrow','symbol','line','measure')),
  data jsonb not null,
  color text not null default '#e11d48',
  measure int,
  doubt_id uuid,
  event_id uuid,
  version int not null default 1,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id) on delete set null
);
create index on annotations(part_id, updated_at);
create index on annotations(marcha_id, updated_at);
alter table annotations add constraint annotations_anchor check (part_id is not null and page is not null or measure is not null);

create table annotation_history (
  id bigserial primary key,
  annotation_id uuid not null,
  user_id uuid references users(id) on delete set null,
  action text not null,
  version int not null,
  snapshot jsonb,
  at timestamptz not null default now()
);

-- ===== Dudas =====
create table doubts (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references parts(id) on delete cascade,
  marcha_id uuid not null references marchas(id) on delete cascade,
  page int not null,
  rect jsonb not null, -- coordenadas normalizadas 0..1 {x,y,w,h}
  measure int,          -- solo si el músico lo conoce/indica; nunca se inventa
  crop_file_id uuid references files(id),
  annotation_payload jsonb,
  audio_file_id uuid references files(id),
  text text not null,
  author_id uuid not null references users(id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private','section','band')),
  status text not null default 'nueva' check (status in ('nueva','pendiente','respondida')),
  priority boolean not null default false,
  promoted_annotation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table doubt_replies (
  id uuid primary key default gen_random_uuid(),
  doubt_id uuid not null references doubts(id) on delete cascade,
  author_id uuid not null references users(id) on delete cascade,
  text text,
  audio_file_id uuid references files(id),
  attachment_file_id uuid references files(id),
  drawing jsonb, -- trazos de la respuesta sobre el fragmento (coordenadas normalizadas de la página)
  annotation_id uuid,
  created_at timestamptz not null default now()
);

-- ===== Eventos, asistencia y ensayo =====
create table events (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('ensayo','actuacion','concierto','procesion','otro')),
  title text not null,
  starts_at timestamptz not null,
  call_at timestamptz,
  ends_at timestamptz,
  location text,
  uniform text,
  notes text,
  responsible_id uuid references users(id) on delete set null,
  section_ids int[] not null default '{}', -- vacío = toda la banda
  status text not null default 'programado' check (status in ('programado','cancelado','finalizado')),
  last_minute text,
  last_minute_at timestamptz,
  summary jsonb,
  checkin_secret text,
  checkin_open boolean not null default false,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on events(starts_at);

create table event_repertoire (
  event_id uuid references events(id) on delete cascade,
  marcha_id uuid references marchas(id) on delete cascade,
  sort int not null default 0,
  primary key (event_id, marcha_id)
);

create table event_rsvp (
  event_id uuid references events(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  response text not null check (response in ('asistire','no_asistire')),
  reason text,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- Registro oficial: solo dirección / responsables con permiso
create table attendance (
  event_id uuid references events(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  status text not null check (status in ('presente','ausente','retraso','justificada','pendiente')),
  minutes_late int,
  note text,
  method text not null default 'manual' check (method in ('manual','qr')),
  recorded_by uuid references users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create table attendance_log (
  id bigserial primary key,
  event_id uuid not null,
  user_id uuid not null,
  old_status text,
  new_status text not null,
  changed_by uuid references users(id) on delete set null,
  method text not null,
  at timestamptz not null default now()
);

create table rehearsal_plan (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  sort int not null default 0,
  title text not null,
  marcha_id uuid references marchas(id) on delete set null,
  measure_from int,
  measure_to int,
  notes text,
  done boolean not null default false
);

-- Pasajes trabajados: permite comparar entre ensayos
create table passage_work (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  marcha_id uuid not null references marchas(id) on delete cascade,
  measure_from int,
  measure_to int,
  note text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Sesión de dirección en tiempo real (estado compartido persistente)
create table live_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete set null,
  director_id uuid not null references users(id),
  state jsonb not null,
  version int not null default 1,
  active boolean not null default true,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table live_device_log (
  id bigserial primary key,
  session_id uuid not null references live_sessions(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  device_id text not null,
  kind text not null, -- connect, disconnect, late_command, resync
  detail jsonb,
  at timestamptz not null default now()
);

-- ===== Comunicación =====
create table announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  urgent boolean not null default false,
  category text not null default 'aviso' check (category in ('aviso','direccion','seccion','cambio')),
  section_ids int[] not null default '{}',
  author_id uuid references users(id) on delete set null,
  event_id uuid references events(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create table announcement_reads (
  announcement_id uuid references announcements(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'general',
  file_id uuid not null references files(id),
  section_ids int[] not null default '{}',
  restricted boolean not null default false, -- solo dirección/responsables
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ===== Academia =====
create table courses (
  id uuid primary key default gen_random_uuid(),
  level int not null check (level between 1 and 3),
  title text not null,
  description text,
  section_id int references sections(id) on delete set null,
  status text not null default 'borrador' check (status in ('borrador','revision','publicado')),
  sort int not null default 0,
  created_by uuid references users(id) on delete set null,
  reviewed_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  sort int not null default 0,
  title text not null,
  explanation text not null,
  demo jsonb,      -- demostración visual (pentagrama, notas)
  audio jsonb,     -- ejemplo auditivo (notas a sintetizar)
  exercise jsonb,  -- ejercicio interactivo
  quiz jsonb not null default '[]',
  practice text,   -- aplicación práctica en una marcha
  summary text,
  status text not null default 'borrador' check (status in ('borrador','revision','publicado')),
  source_material_id uuid references files(id),
  reviewed_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table lesson_progress (
  user_id uuid references users(id) on delete cascade,
  lesson_id uuid references lessons(id) on delete cascade,
  completed_at timestamptz,
  quiz_score int,
  attempts int not null default 0,
  primary key (user_id, lesson_id)
);

create table exercise_results (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  exercise text not null, -- lectura, oido, ritmo
  item text not null,     -- p.ej. "G4"
  correct boolean not null,
  ms int,
  at timestamptz not null default now()
);
create index on exercise_results(user_id, exercise);

create table study_days (
  user_id uuid references users(id) on delete cascade,
  day date not null,
  minutes int not null default 0,
  primary key (user_id, day)
);

create table material_usage (
  id bigserial primary key,
  user_id uuid references users(id) on delete cascade,
  kind text not null,
  ref_id text,
  at timestamptz not null default now()
);

-- Material, instrumentos y uniformidad
create table inventory_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('instrumento','uniforme','material')),
  name text not null,
  code text,
  size text,
  condition text not null default 'bueno' check (condition in ('nuevo','bueno','regular','reparacion','baja')),
  assigned_to uuid references users(id) on delete set null,
  notes text,
  updated_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  action text not null,
  entity text,
  entity_id text,
  data jsonb,
  at timestamptz not null default now()
);

-- Parte que debe abrirse por defecto para un componente en un evento concreto
create table event_assignment_overrides (
  event_id uuid references events(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  assignment_id int not null references user_assignments(id) on delete cascade,
  primary key (event_id, user_id)
);
