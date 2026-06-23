create or replace function public.normalize_organization_name(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(coalesce(value, ''), '[^a-z0-9]+', '', 'g'));
$$;

alter table public.outreach_logs
  add column if not exists organization_name text;

update public.outreach_logs
set organization_name = coalesce(
  nullif(trim(data->>'Organization'), ''),
  nullif(trim(data->>'Church Name'), ''),
  'Legacy entry ' || id::text
)
where organization_name is null or trim(organization_name) = '';

alter table public.outreach_logs
  alter column organization_name set not null;

alter table public.outreach_logs
  drop constraint if exists outreach_logs_organization_name_check;

alter table public.outreach_logs
  add constraint outreach_logs_organization_name_check
  check (length(trim(organization_name)) > 0);

create unique index if not exists outreach_logs_organization_unique_idx
  on public.outreach_logs (public.normalize_organization_name(organization_name));

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
