create sequence if not exists public.manager_number_seq;

alter table public.manager_profiles
  add column if not exists manager_number integer,
  add column if not exists active boolean not null default true;

create unique index if not exists manager_profiles_manager_number_unique
  on public.manager_profiles (manager_number)
  where manager_number is not null;

create or replace function public.assign_manager_number()
returns trigger
language plpgsql
as $$
begin
  if new.manager_number is null then
    new.manager_number = nextval('public.manager_number_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists manager_profiles_assign_manager_number on public.manager_profiles;
create trigger manager_profiles_assign_manager_number
before insert on public.manager_profiles
for each row execute function public.assign_manager_number();

update public.manager_profiles
set manager_number = nextval('public.manager_number_seq')
where manager_number is null;

select setval(
  'public.manager_number_seq',
  greatest(
    coalesce((select max(manager_number) from public.manager_profiles), 0),
    1
  ),
  true
);

create table if not exists public.outreach_tasks (
  id uuid primary key default gen_random_uuid(),
  batch_id text,
  organization_name text not null,
  organization_type text,
  organization_website text,
  fit_reason text,
  contact_name text,
  contact_email text not null,
  draft_email text not null,
  draft_subject text,
  assigned_to uuid references public.manager_profiles(user_id),
  assigned_manager_number integer,
  status text not null default 'pending_review' check (
    status in ('pending_review', 'needs_edit', 'approved', 'sent', 'rejected', 'failed')
  ),
  manager_notes text,
  sent_at timestamptz,
  sent_by uuid references auth.users(id),
  created_by_agent text,
  source_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists outreach_tasks_contact_website_unique
  on public.outreach_tasks (lower(contact_email), lower(coalesce(organization_website, organization_name)));

create index if not exists outreach_tasks_assigned_to_idx
  on public.outreach_tasks (assigned_to, status, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists manager_profiles_set_updated_at on public.manager_profiles;
create trigger manager_profiles_set_updated_at
before update on public.manager_profiles
for each row execute function public.set_updated_at();

drop trigger if exists outreach_tasks_set_updated_at on public.outreach_tasks;
create trigger outreach_tasks_set_updated_at
before update on public.outreach_tasks
for each row execute function public.set_updated_at();

alter table public.outreach_tasks enable row level security;

drop policy if exists "Tasks are visible to assigned managers and admins"
  on public.outreach_tasks;
create policy "Tasks are visible to assigned managers and admins"
on public.outreach_tasks
for select
to authenticated
using (
  assigned_to = (select auth.uid())
  or (select private.is_app_admin())
);

drop policy if exists "Assigned managers and admins can update tasks"
  on public.outreach_tasks;
create policy "Assigned managers and admins can update tasks"
on public.outreach_tasks
for update
to authenticated
using (
  assigned_to = (select auth.uid())
  or (select private.is_app_admin())
)
with check (
  assigned_to = (select auth.uid())
  or (select private.is_app_admin())
);

drop policy if exists "Admins can delete tasks"
  on public.outreach_tasks;
create policy "Admins can delete tasks"
on public.outreach_tasks
for delete
to authenticated
using ((select private.is_app_admin()));

grant select, update, delete on public.outreach_tasks to authenticated;
grant select on public.manager_profiles to service_role;
grant select, insert, update, delete on public.outreach_tasks to service_role;
grant usage, select on sequence public.manager_number_seq to service_role;

do $$
begin
  alter publication supabase_realtime add table public.outreach_tasks;
exception
  when duplicate_object then null;
end
$$;
