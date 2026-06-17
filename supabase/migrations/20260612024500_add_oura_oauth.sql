create table if not exists public.oura_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  token_type text not null default 'bearer',
  scope text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_synced_at timestamptz
);

create table if not exists public.oura_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_to text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.oura_connections enable row level security;
alter table public.oura_oauth_states enable row level security;

create index if not exists oura_oauth_states_user_id_idx on public.oura_oauth_states(user_id);
create index if not exists oura_oauth_states_expires_at_idx on public.oura_oauth_states(expires_at);
