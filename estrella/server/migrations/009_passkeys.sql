-- Entrar con Face ID / huella (passkeys, WebAuthn). Solo se guarda la clave pública.
create table if not exists webauthn_credentials (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  public_key bytea not null,
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists webauthn_credentials_user_idx on webauthn_credentials(user_id);
