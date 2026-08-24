create table if not exists public.coach_recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recommendation_date date not null,
  pattern text,
  meaning text,
  action text not null,
  why text,
  source_context jsonb not null default '{}'::jsonb,
  prompt_version text not null default 'native-daily-v1',
  model text,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, recommendation_date)
);

alter table public.coach_recommendations enable row level security;

create policy "Users can read their coach recommendations" on public.coach_recommendations for select using (auth.uid() = user_id);
create policy "Users can create their coach recommendations" on public.coach_recommendations for insert with check (auth.uid() = user_id);
create policy "Users can update their coach recommendations" on public.coach_recommendations for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their coach recommendations" on public.coach_recommendations for delete using (auth.uid() = user_id);

create index if not exists coach_recommendations_user_date_idx on public.coach_recommendations (user_id, recommendation_date desc);
