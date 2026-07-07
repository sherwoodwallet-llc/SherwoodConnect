# Lead Outreach Agent System

Local Docker setup for an n8n-controlled multi-agent lead research and email outreach workflow.

n8n is the master orchestrator. Each subagent is a small FastAPI service that n8n calls over the private Docker network.

## Services

| Service | Purpose | n8n URL |
| --- | --- | --- |
| `n8n` | Master workflow/boss agent | `http://localhost:5678` from your browser |
| `postgres` | n8n database and persistent state | internal only |
| `company-research-agent` | Finds mock target companies | `http://company-research-agent:8000/run` |
| `scoring-agent` | Scores companies and approves/reviews/rejects | `http://scoring-agent:8000/run` |
| `contact-finder-agent` | Finds placeholder decision-maker contacts | `http://contact-finder-agent:8000/run` |
| `email-drafting-agent` | Drafts short personalized outreach emails | `http://email-drafting-agent:8000/run` |
| `outreach-task-agent` | Inserts drafted email tasks into Supabase for Sherwood managers | `http://outreach-task-agent:8000/run` |
| `email-sending-agent` | Dry-runs or sends email through SMTP, not used in the manager-review flow | `http://email-sending-agent:8000/run` |
| `logging-agent` | Saves outreach records to Supabase or local JSONL | `http://logging-agent:8000/run` |

Redis is intentionally not included in this first version.

## Local-Only Security

This is for local development only.

- n8n is bound to `127.0.0.1:5678`.
- Subagents are not published to your host by default. They use `expose: ["8000"]`, so n8n can reach them by Docker service name.
- Subagents are intentionally unauthenticated for local development only.
- Real email sending is disabled by default with `SEND_EMAILS=false`.
- Do not commit real API keys, SMTP credentials, Supabase service-role keys, or n8n encryption keys.

## Install Docker

Install Docker Desktop:

- Mac/Windows: https://www.docker.com/products/docker-desktop/
- Linux: https://docs.docker.com/engine/install/

After installing, open Docker Desktop and make sure it is running.

Check Docker:

```bash
docker --version
docker compose version
```

## Start the System

From the parent directory:

```bash
cd lead-outreach-agent-system
cp .env.example .env
```

Generate a real n8n encryption key:

```bash
openssl rand -hex 32
```

Open `.env` and replace:

```env
N8N_ENCRYPTION_KEY=replace_with_generated_64_character_hex_key
```

with your generated value. If you already generated a key, paste that value into `.env`.

Start everything:

```bash
docker compose up -d
docker ps
```

Open n8n:

```text
http://localhost:5678
```

Stop everything:

```bash
docker compose down
```

Delete all local Docker volumes too:

```bash
docker compose down -v
```

Be careful: `docker compose down -v` deletes the local Postgres, n8n, and logging volumes.

## What Data Survives

These survive `docker compose down`:

- n8n workflows and credentials in `postgres_data`
- n8n local config files in `n8n_data`
- local logging fallback file in `logging_data`

These are deleted by `docker compose down -v`.

If Supabase is configured, logging records stored in Supabase live outside Docker and are not deleted by Docker commands.

## Supabase Storage

The outreach task agent inserts manager-review tasks into the Sherwood website Supabase project. The logging agent also stores to Supabase if these `.env` values are set:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_LOG_TABLE=outreach_logs
```

For the Sherwood website, run the migration at:

```text
/Users/hadiabdul/Documents/Mentorship Site/Sherwood/supabase/migrations/20260623000000_outreach_tasks.sql
```

That migration creates:

- `profiles`: one row per website user, with `master` or `outreach_manager` role.
- `outreach_tasks`: one row per drafted outreach email.
- automatic manager numbering.
- row-level security so managers only see their assigned tasks, while the master account can see all tasks.

The master email is:

```text
hadiabdul8128@gmail.com
```

Create this optional logging table in Supabase if you want workflow logs there too:

```sql
create table if not exists outreach_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text,
  payload jsonb not null
);
```

If Supabase values are blank, the logging agent writes to `/data/outreach_logs.jsonl` inside the persistent `logging_data` volume.

If Supabase values are blank, `outreach-task-agent` can start, but `/run` will return a configuration error because it cannot create website tasks without Supabase.

`outreach-task-agent` enforces Tracy's completion gate before writing:

- fetch active managers from `manager_profiles`.
- check current task load and assign complete 3-draft sets to the least-loaded managers first.
- skip duplicates by `lower(contact_email)` plus matching website or organization name.
- insert selected rows in one bulk request so an insert conflict fails the batch instead of giving a manager fewer than 3 new tasks.

## n8n Workflow

Create this simple n8n workflow:

```text
Manual Trigger
↓
Set target criteria
↓
HTTP Request → company-research-agent /run
↓
HTTP Request → scoring-agent /run
↓
IF score >= 75
↓
HTTP Request → contact-finder-agent /run
↓
HTTP Request → email-drafting-agent /run
↓
HTTP Request → outreach-task-agent /run
↓
HTTP Request → logging-agent /run
```

Use `POST` requests with `Content-Type: application/json`.

Important URL distinction:

- From your browser, n8n is at `http://localhost:5678`.
- From inside n8n, agents are reached by service name, for example `http://company-research-agent:8000/run`.
- Do not use `localhost:8000` inside n8n. Inside the n8n container, `localhost` means the n8n container itself.

### 1. Manual Trigger

Add a Manual Trigger node.

### 2. Set Target Criteria

Add a Set node with this JSON:

```json
{
  "target_criteria": "churches, mosques, temples, religious centers, homeless shelters, food pantries, and local nonprofits",
  "location": "United States",
  "keywords": ["church", "food pantry", "homeless shelter", "local nonprofit", "donate", "volunteer", "events"],
  "limit": 10
}
```

### 3. Company Research HTTP Request

POST to:

```text
http://company-research-agent:8000/run
```

Body:

```json
{
  "task": "research_companies",
  "input": {
    "target_criteria": "churches, mosques, temples, religious centers, homeless shelters, food pantries, and local nonprofits",
    "location": "United States",
    "keywords": ["church", "food pantry", "homeless shelter", "local nonprofit", "donate", "volunteer", "events"],
    "limit": 10
  }
}
```

### 4. Scoring HTTP Request

POST to:

```text
http://scoring-agent:8000/run
```

Body shape:

```json
{
  "task": "score_companies",
  "input": {
    "companies": []
  }
}
```

In n8n, map `companies` from the company research response.

Only companies with `decision: "approve"` should continue automatically.

### 5. Contact Finder HTTP Request

POST to:

```text
http://contact-finder-agent:8000/run
```

Body:

```json
{
  "task": "find_contacts",
  "input": {
    "company": {
      "name": "Example Community Food Pantry",
      "website": "https://example.org",
      "lead_category": "food_pantry"
    },
    "target_roles": ["Executive Director", "Director", "Community Outreach", "Volunteer Coordinator", "Development Director"]
  }
}
```

### 6. Email Drafting HTTP Request

POST to:

```text
http://email-drafting-agent:8000/run
```

Body:

```json
{
  "task": "draft_email",
  "input": {
    "company": {
      "name": "Example Community Food Pantry",
      "description": "weekly food support, volunteer programs, and local community services",
      "lead_category": "food_pantry"
    },
    "contact": {
      "name": "Jane Doe",
      "email": "jane@example.com"
    },
    "sender_profile": {
      "name": "__SENDER_NAME__",
      "background": "part of the Sherwood outreach team helping mission-driven organizations improve their digital outreach",
      "goal": "see whether a lightweight website, donor, volunteer, or outreach improvement could be useful"
    }
  }
}
```

### 7. Outreach Task HTTP Request

POST to:

```text
http://outreach-task-agent:8000/run
```

Body:

```json
{
  "task": "create_outreach_tasks",
  "input": {
    "batch_id": "manual-test",
    "drafts": [
      {
        "organization_name": "Example Community Food Pantry",
        "organization_type": "food_pantry",
        "organization_website": "https://example.org",
        "fit_reason": "Local mission-driven organization with volunteer and donation programs.",
        "contact_name": "Jane Doe",
        "contact_email": "jane@example.com",
        "draft_subject": "Quick question",
        "draft_email": "Personalized email body here"
      }
    ]
  }
}
```

This creates `pending_review` rows in Supabase and randomly distributes them across active outreach managers using round-robin assignment. The website reads those rows from Supabase.

### 8. Logging HTTP Request

POST to:

```text
http://logging-agent:8000/run
```

Body:

```json
{
  "task": "log_outreach",
  "input": {
    "company": {},
    "contact": {},
    "score": 86,
    "email": {},
    "status": "queued_for_manager_review"
  }
}
```

## Acceptance Tests

Run these after:

```bash
cp .env.example .env
docker compose up -d
```

Check n8n from your host:

```bash
curl http://localhost:5678
```

Because subagent ports are not published to your host, test them through a temporary curl container on the same Docker network.

Company research:

```bash
docker run --rm --network lead-outreach-agent-network curlimages/curl:8.11.1 \
  -X POST http://company-research-agent:8000/run \
  -H "Content-Type: application/json" \
  -d '{"task":"research_companies","input":{"target_criteria":"churches, mosques, temples, religious centers, homeless shelters, food pantries, and local nonprofits","location":"United States","keywords":["church","food pantry","homeless shelter","local nonprofit","donate","volunteer","events"],"limit":10}}'
```

Scoring:

```bash
docker run --rm --network lead-outreach-agent-network curlimages/curl:8.11.1 \
  -X POST http://scoring-agent:8000/run \
  -H "Content-Type: application/json" \
  -d '{"task":"score_companies","input":{"companies":[{"name":"Example Community Food Pantry","website":"https://example.org","domain":"example.org","lead_category":"food_pantry","classification_confidence":0.9,"description":"Weekly food support, volunteer programs, donation page, and local community services.","signals":["contact page","donate page","volunteer page"]}]}}'
```

Contact finder:

```bash
docker run --rm --network lead-outreach-agent-network curlimages/curl:8.11.1 \
  -X POST http://contact-finder-agent:8000/run \
  -H "Content-Type: application/json" \
  -d '{"task":"find_contacts","input":{"company":{"name":"Example Community Food Pantry","website":"https://example.org","lead_category":"food_pantry"},"target_roles":["Executive Director","Director","Community Outreach","Volunteer Coordinator","Development Director"]}}'
```

Email drafting:

```bash
docker run --rm --network lead-outreach-agent-network curlimages/curl:8.11.1 \
  -X POST http://email-drafting-agent:8000/run \
  -H "Content-Type: application/json" \
  -d '{"task":"draft_email","input":{"company":{"name":"Example Community Food Pantry","description":"weekly food support, volunteer programs, and local community services","lead_category":"food_pantry"},"contact":{"name":"Jane Doe","email":"jane@example.org"},"sender_profile":{"name":"__SENDER_NAME__","background":"part of the Sherwood outreach team helping mission-driven organizations improve their digital outreach","goal":"see whether a lightweight website, donor, volunteer, or outreach improvement could be useful"}}}'
```

Outreach task creation:

```bash
docker run --rm --network lead-outreach-agent-network curlimages/curl:8.11.1 \
  -X POST http://outreach-task-agent:8000/run \
  -H "Content-Type: application/json" \
  -d '{"task":"create_outreach_tasks","input":{"batch_id":"manual-test","drafts":[{"organization_name":"Example Community Food Pantry","organization_type":"food_pantry","organization_website":"https://example.org","fit_reason":"Local mission-driven organization with volunteer and donation programs.","contact_name":"Jane Doe","contact_email":"jane@example.org","draft_subject":"Quick question","draft_email":"Hi Jane,\\n\\nShort version: I am __SENDER_NAME__, part of the Sherwood outreach team.\\n\\nBest,\\n__SENDER_NAME__"}]}}'
```

This requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the Sherwood Supabase migration.

Email sending dry run:

```bash
docker run --rm --network lead-outreach-agent-network curlimages/curl:8.11.1 \
  -X POST http://email-sending-agent:8000/run \
  -H "Content-Type: application/json" \
  -d '{"task":"send_email","input":{"decision":"approve","email":{"to":"jane@example.com","subject":"Quick question","body":"Personalized email body here"}}}'
```

Logging:

```bash
docker run --rm --network lead-outreach-agent-network curlimages/curl:8.11.1 \
  -X POST http://logging-agent:8000/run \
  -H "Content-Type: application/json" \
  -d '{"task":"log_outreach","input":{"company":{"name":"Example Community Food Pantry"},"contact":{"email":"jane@example.org"},"score":86,"email":{"subject":"Quick question"},"status":"drafted"}}'
```

## Exact Commands

```bash
cd lead-outreach-agent-system
cp .env.example .env
docker compose up -d
docker ps
```

Before using n8n seriously, replace the placeholder `N8N_ENCRYPTION_KEY` in `.env` with a real `openssl rand -hex 32` value.
