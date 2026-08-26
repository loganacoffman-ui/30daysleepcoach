-- Additive persistence for the native Coach chat. Existing coaching, journal,
-- Oura, profile, and daily-loop tables are intentionally unchanged.

create table if not exists public.coach_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Sleep coaching' check (char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.coach_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(trim(content)) between 1 and 12000),
  client_request_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, client_request_id)
);

alter table public.coach_conversations enable row level security;
alter table public.coach_messages enable row level security;

create policy "Users can read their coach conversations"
  on public.coach_conversations for select to authenticated
  using (auth.uid() = user_id);
create policy "Users can create their coach conversations"
  on public.coach_conversations for insert to authenticated
  with check (auth.uid() = user_id);
create policy "Users can update their coach conversations"
  on public.coach_conversations for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their coach conversations"
  on public.coach_conversations for delete to authenticated
  using (auth.uid() = user_id);

create policy "Users can read their coach messages"
  on public.coach_messages for select to authenticated
  using (auth.uid() = user_id);
create policy "Users can create messages in their coach conversations"
  on public.coach_messages for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.coach_conversations conversation
      where conversation.id = conversation_id
        and conversation.user_id = auth.uid()
    )
  );
create policy "Users can delete their coach messages"
  on public.coach_messages for delete to authenticated
  using (auth.uid() = user_id);

revoke all on public.coach_conversations from anon;
revoke all on public.coach_messages from anon;
grant select, insert, update, delete on public.coach_conversations to authenticated;
grant select, insert, delete on public.coach_messages to authenticated;

create index if not exists coach_conversations_user_updated_idx
  on public.coach_conversations (user_id, updated_at desc);
create index if not exists coach_messages_conversation_created_idx
  on public.coach_messages (conversation_id, created_at asc);
create index if not exists coach_messages_user_created_idx
  on public.coach_messages (user_id, created_at desc);
