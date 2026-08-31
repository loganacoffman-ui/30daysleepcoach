create table public.push_notification_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  app_variant text not null default 'production',
  timezone text not null default 'UTC',
  reminder_time time not null default '08:00',
  enabled boolean not null default true,
  last_registered_at timestamptz not null default now(),
  last_sent_local_date date,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index push_notification_devices_due_idx
  on public.push_notification_devices (enabled, reminder_time)
  where enabled = true;

alter table public.push_notification_devices enable row level security;

create policy "Users can read their push devices"
  on public.push_notification_devices for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can register their push devices"
  on public.push_notification_devices for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their push devices"
  on public.push_notification_devices for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can remove their push devices"
  on public.push_notification_devices for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.push_notification_devices from anon;
grant select, insert, update, delete on public.push_notification_devices to authenticated;
grant all on public.push_notification_devices to service_role;

create table public.push_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.push_notification_devices(id) on delete cascade,
  expo_ticket_id text unique,
  kind text not null,
  status text not null default 'submitted',
  error_code text,
  submitted_at timestamptz not null default now(),
  checked_at timestamptz
);

create index push_notification_deliveries_pending_idx
  on public.push_notification_deliveries (submitted_at)
  where status = 'submitted' and expo_ticket_id is not null;

alter table public.push_notification_deliveries enable row level security;
revoke all on public.push_notification_deliveries from anon, authenticated;
grant all on public.push_notification_deliveries to service_role;
