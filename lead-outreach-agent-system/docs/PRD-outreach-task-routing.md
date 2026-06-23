# PRD: Outreach Draft Task Routing

## Overview

Sherwood Connect needs a workflow where local Dockerized outreach agents generate email drafts, save the important draft information to Supabase, and make those drafts visible inside the Sherwood Connect website for outreach managers to manually send.

The current local agent system includes:

- `company-research-agent`
- `scoring-agent`
- `contact-finder-agent`
- `email-drafting-agent`
- `email-sending-agent`
- `logging-agent`

The website is:

```text
https://sherwood-connect-nu.vercel.app
```

The website should not receive draft data through browser automation. The agent system should insert draft task rows into Supabase. The website should read from Supabase and show each manager their assigned outreach tasks.

## Product Goal

Create a reliable outreach task queue where:

1. Agents generate draft outreach emails.
2. Drafts are stored in Supabase.
3. Drafts are fairly assigned to outreach managers.
4. Outreach managers log into Sherwood Connect and see only their assigned email tasks.
5. Managers manually send the emails outside the agent system.
6. Managers mark tasks as sent.
7. The master user can see all tasks, assignments, and completion status.

## Users

### Master User

The master user is the overseer account.

Initial master email:

```text
hadiabdul8128@gmail.com
```

The app should not hardcode master permissions by email in frontend code. The email should map to a Supabase profile role of `master`.

Master user capabilities:

- View all outreach tasks.
- View all outreach managers.
- See task counts by manager.
- See sent, pending, rejected, and needs-edit status.
- Reassign tasks if needed.
- Add or deactivate managers if the app supports manager administration.

### Outreach Manager

Outreach managers are normal users who manually send drafted emails.

Manager capabilities:

- Log in to Sherwood Connect.
- See assigned outreach tasks.
- Copy or use the draft email.
- Mark a task as sent.
- Mark a task as needs edit or rejected if needed.
- Add notes.

Managers should not see tasks assigned to other managers unless explicitly promoted to master.

## Source of Truth

The subagents are the source of generated outreach data.

Supabase is the persistent system of record used by the website.

Flow:

```text
n8n workflow
-> subagents generate company/contact/draft data
-> sync agent inserts outreach task rows into Supabase
-> website reads Supabase rows
-> managers update task status in Supabase
-> master dashboard reads status from Supabase
```

## Non-Goals

This version should not:

- Send real emails automatically.
- Scrape websites or LinkedIn.
- Use Gmail API.
- Use Vercel credentials unless deployment changes are needed.
- Automate data entry through the website UI.
- Reassign existing tasks automatically every time a manager logs in.

## Core Task Fields

Each outreach task should include these seven manager-facing fields:

1. `organization_name`
2. `organization_type`
3. `organization_website`
4. `fit_reason`
5. `contact_name`
6. `contact_email`
7. `draft_email`

Additional internal fields are needed for assignment, status, deduplication, and auditability.

## Recommended Supabase Data Model

### `profiles`

Stores app users and roles.

Fields:

```text
id uuid primary key references auth.users(id)
email text not null unique
full_name text
role text not null check role in ('master', 'outreach_manager')
manager_number integer unique
active boolean not null default true
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Notes:

- Supabase Auth user UUID should be the real stable user ID.
- `manager_number` gives each manager a simple readable number.
- Assign `manager_number` when a new outreach manager profile is created.
- Master users can have `manager_number` as null.

### `outreach_tasks`

Stores generated draft email tasks.

Fields:

```text
id uuid primary key default gen_random_uuid()
batch_id uuid
organization_name text not null
organization_type text
organization_website text
fit_reason text
contact_name text
contact_email text not null
draft_email text not null
draft_subject text
assigned_to uuid references profiles(id)
assigned_manager_number integer
status text not null default 'pending_review'
manager_notes text
sent_at timestamptz
sent_by uuid references profiles(id)
created_by_agent text
source_payload jsonb
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Recommended status values:

```text
pending_review
needs_edit
approved
sent
rejected
failed
```

### Duplicate Prevention

Add a uniqueness rule to avoid repeated tasks for the same contact and organization.

Recommended unique key:

```text
contact_email + organization_website
```

If an organization website is unavailable, fallback duplicate checking should use:

```text
contact_email + organization_name
```

## Assignment Logic

Assignments should happen once when new tasks are inserted into Supabase.

Rules:

1. Fetch active outreach managers:

```text
role = 'outreach_manager'
active = true
```

2. Randomly shuffle the active manager list.

3. Assign tasks round-robin across the shuffled list.

Example:

```text
15 drafts, 5 managers -> 3 each
16 drafts, 5 managers -> 4, 3, 3, 3, 3
15 drafts, 6 managers -> 3, 3, 3, 2, 2, 2
```

4. Existing tasks should not be reassigned automatically when a new manager is added.

5. New managers should be included in assignment for future batches.

6. Master can manually reassign tasks later if needed.

## Agent Changes Required

The current `email-sending-agent` should not directly send emails for this workflow.

Recommended change:

- Keep `email-sending-agent` dry-run only for now.
- Add a new `website-sync-agent` or `outreach-task-agent`.

The new sync agent should:

1. Accept draft outreach records from n8n.
2. Format them into the seven core task fields.
3. Fetch active outreach managers from Supabase.
4. Assign tasks fairly.
5. Insert rows into `outreach_tasks`.
6. Return inserted task IDs and assignment summary.

Recommended endpoint:

```text
POST /run
```

Example input:

```json
{
  "task": "create_outreach_tasks",
  "input": {
    "drafts": [
      {
        "organization_name": "Example Community Food Pantry",
        "organization_type": "food_pantry",
        "organization_website": "https://example.org",
        "fit_reason": "Local mission-driven organization with volunteer and donation programs.",
        "contact_name": "Jane Doe",
        "contact_email": "jane@example.org",
        "draft_email": "Hi Jane..."
      }
    ]
  }
}
```

Example output:

```json
{
  "agent": "outreach-task-agent",
  "created": 15,
  "skipped_duplicates": 0,
  "assignments": [
    {
      "manager_number": 1,
      "task_count": 3
    }
  ]
}
```

## Website Requirements

### Outreach Manager Home Screen

Managers should see:

- Assigned pending tasks.
- Organization name.
- Organization type.
- Organization website.
- Fit reason.
- Contact name.
- Contact email.
- Draft email.
- Button: `Mark as Sent`.
- Button or status: `Needs Edit`.
- Button or status: `Reject`.
- Notes field.

When a manager clicks `Mark as Sent`, update:

```text
status = 'sent'
sent_at = now()
sent_by = current_user.id
```

### Master Dashboard

Master should see:

- Total generated tasks.
- Pending tasks.
- Sent tasks.
- Rejected tasks.
- Needs-edit tasks.
- Completion rate by manager.
- Table of all tasks.
- Assignee for each task.
- Ability to filter by manager and status.

Recommended manager summary:

```text
Manager Name
Manager Number
Assigned Count
Pending Count
Sent Count
Completion %
```

## Security and Permissions

Use Supabase Row Level Security.

Recommended policy behavior:

- Outreach managers can select tasks where `assigned_to = auth.uid()`.
- Outreach managers can update only their own task status and notes.
- Outreach managers cannot change `assigned_to`.
- Master users can select and update all tasks.
- The sync agent should use a Supabase service-role key only from server-side/container environment variables.
- Never expose service-role keys in frontend code.

## n8n Workflow Changes

Current flow:

```text
Research Companies
-> Score Companies
-> Approved Company Gate
-> Find Contacts
-> Draft Email
-> Send Email Dry Run
-> Log Outreach
```

Target flow:

```text
Research Companies
-> Score Companies
-> Approved Company Gate
-> Find Contacts
-> Draft Email
-> Create Outreach Task in Supabase
-> Log Outreach
```

The `Send Email Dry Run` node can remain for local testing, but the production manager workflow should create tasks, not send emails.

## Acceptance Criteria

### Agent/Supabase

- Given 15 generated draft emails and 5 active outreach managers, the system creates 15 Supabase task rows and assigns 3 to each manager.
- Given 16 drafts and 5 managers, assignment differs by no more than one task per manager.
- Given a newly added sixth active manager, future batches include that manager.
- Duplicate contact/company tasks are skipped or updated according to the duplicate policy.
- No real email is sent by the agent system.

### Outreach Manager UI

- A manager can log in and see only their assigned tasks.
- A manager can view all seven core fields.
- A manager can mark a task as sent.
- Sent tasks disappear from the default pending task list or are visibly marked as sent.

### Master UI

- Master can see all tasks.
- Master can see which manager each task is assigned to.
- Master can see completion counts by manager.
- Master can see when a manager marked a task as sent.

## Open Questions Before Build

1. What is the actual Supabase schema for the current Sherwood Connect website?
2. Does the website already have a `profiles` table or role system?
3. Does the website already distinguish master users from outreach managers?
4. Should managers paste/send emails manually outside the site, or should the site include a `mailto:` button?
5. Should rejected or needs-edit tasks go back to master review?
6. Should assignment be random every batch or deterministic based on manager load?
7. Should the agent insert one task at a time or batch insert many tasks after a full n8n run?

## Recommended Build Order

1. Inspect the Sherwood Connect repo and Supabase schema.
2. Add or adapt `profiles` and `outreach_tasks` tables.
3. Add RLS policies.
4. Build manager task list UI.
5. Build master dashboard.
6. Add `outreach-task-agent`.
7. Update n8n workflow to call the new agent.
8. Run a dry-run batch and verify manager assignment.
