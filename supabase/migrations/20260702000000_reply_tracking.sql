alter table public.outreach_tasks
  add column if not exists response_status text not null default 'not_tracked' check (
    response_status in (
      'not_tracked',
      'no_response',
      'replied',
      'positive',
      'neutral',
      'negative',
      'bounced',
      'wrong_contact',
      'do_not_contact'
    )
  ),
  add column if not exists response_score smallint not null default 0 check (
    response_score between -2 and 3
  ),
  add column if not exists response_received_at timestamptz,
  add column if not exists response_excerpt text,
  add column if not exists response_notes text,
  add column if not exists response_updated_at timestamptz,
  add column if not exists response_updated_by uuid references auth.users(id);

create index if not exists outreach_tasks_response_status_idx
  on public.outreach_tasks (response_status, response_score, response_received_at desc);

comment on column public.outreach_tasks.response_status is
  'Manager-tracked reply outcome for Tracy performance analysis.';
comment on column public.outreach_tasks.response_score is
  'Lightweight learning signal: -2 bad, -1 weak, 0 unknown/no signal, 1 reply, 2 positive, 3 booked/high intent.';
comment on column public.outreach_tasks.response_excerpt is
  'Optional pasted reply excerpt for later qualitative analysis. Avoid secrets.';
comment on column public.outreach_tasks.response_notes is
  'Manager notes about why the draft may have worked or failed.';
