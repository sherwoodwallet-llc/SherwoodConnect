create extension if not exists pgcrypto;

create schema if not exists private;

create table if not exists public.app_admins (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

insert into public.app_admins (email)
values ('hadiabdul8128@gmail.com')
on conflict (email) do nothing;

alter table public.app_admins enable row level security;

create or replace function private.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_admins
    where email = lower(coalesce((select auth.jwt()->>'email'), ''))
  );
$$;

revoke all on function private.is_app_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_app_admin() to authenticated;

create table if not exists public.manager_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null check (length(trim(name)) > 0),
  initials text not null check (
    length(trim(initials)) between 1 and 4
    and initials = upper(initials)
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outreach_logs (
  id uuid primary key default gen_random_uuid(),
  organization_name text not null check (length(trim(organization_name)) > 0),
  data jsonb not null default '{}'::jsonb,
  owner_uid uuid not null references auth.users(id) on delete cascade,
  owner_email text not null,
  owner_name text not null,
  created_at timestamptz not null default now()
);

create or replace function public.normalize_organization_name(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(coalesce(value, ''), '[^a-z0-9]+', '', 'g'));
$$;

create unique index if not exists outreach_logs_organization_unique_idx
  on public.outreach_logs (public.normalize_organization_name(organization_name));
create index if not exists outreach_logs_owner_uid_idx
  on public.outreach_logs (owner_uid);
create index if not exists outreach_logs_created_at_idx
  on public.outreach_logs (created_at desc);

alter table public.manager_profiles enable row level security;
alter table public.outreach_logs enable row level security;

drop policy if exists "Profiles are visible to their owner and admins"
  on public.manager_profiles;
create policy "Profiles are visible to their owner and admins"
on public.manager_profiles
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or (select private.is_app_admin())
);

drop policy if exists "Users can create their own profile"
  on public.manager_profiles;
create policy "Users can create their own profile"
on public.manager_profiles
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and lower(email) = lower(coalesce((select auth.jwt()->>'email'), ''))
);

drop policy if exists "Users can update their own profile"
  on public.manager_profiles;
create policy "Users can update their own profile"
on public.manager_profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and lower(email) = lower(coalesce((select auth.jwt()->>'email'), ''))
);

drop policy if exists "Logs are visible to their owner and admins"
  on public.outreach_logs;
create policy "Logs are visible to their owner and admins"
on public.outreach_logs
for select
to authenticated
using (
  (select auth.uid()) = owner_uid
  or (select private.is_app_admin())
);

drop policy if exists "Users can create their own logs"
  on public.outreach_logs;
create policy "Users can create their own logs"
on public.outreach_logs
for insert
to authenticated
with check (
  (select auth.uid()) = owner_uid
  and lower(owner_email) = lower(coalesce((select auth.jwt()->>'email'), ''))
);

drop policy if exists "Owners and admins can update logs"
  on public.outreach_logs;
create policy "Owners and admins can update logs"
on public.outreach_logs
for update
to authenticated
using (
  (select auth.uid()) = owner_uid
  or (select private.is_app_admin())
)
with check (
  (select auth.uid()) = owner_uid
  or (select private.is_app_admin())
);

drop policy if exists "Owners and admins can delete logs"
  on public.outreach_logs;
create policy "Owners and admins can delete logs"
on public.outreach_logs
for delete
to authenticated
using (
  (select auth.uid()) = owner_uid
  or (select private.is_app_admin())
);

grant select, insert, update on public.manager_profiles to authenticated;
grant select, insert, update, delete on public.outreach_logs to authenticated;

create or replace function public.organization_is_available(organization text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    length(public.normalize_organization_name(organization)) > 0
    and not exists (
      select 1
      from public.outreach_logs
      where public.normalize_organization_name(organization_name)
        = public.normalize_organization_name(organization)
    );
$$;

revoke all on function public.organization_is_available(text) from public;
grant execute on function public.organization_is_available(text) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.outreach_logs;
exception
  when duplicate_object then null;
end
$$;
