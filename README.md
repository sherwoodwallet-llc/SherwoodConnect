# Sherwood Connect

Next.js app for Sherwood manager outreach logs. Supabase provides passwordless
email authentication, profiles, outreach logs, realtime updates, and row-level
security. Managers check an organization name before entering outreach details;
the database returns only availability and prevents duplicate organizations.
New users are asked for a name and initials after their first login.

## Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor** and run the files in `supabase/migrations` in filename
   order. Existing installations that already ran the initial schema only need
   to run `20260620000001_organization_deduplication.sql`.
3. In **Authentication → URL Configuration**, set:
   - Site URL: `https://sherwood-connect.vercel.app`
   - Redirect URLs: `http://localhost:3000/**` and
     `https://sherwood-connect.vercel.app/**`
4. Keep email sign-in enabled in **Authentication → Providers → Email**.
5. Copy `.env.example` to `.env.local` and add the project URL and publishable
   key from **Project Settings → API**.

If master access changes, update both `NEXT_PUBLIC_MASTER_EMAIL` and the
matching rows in `public.app_admins`. Multiple master emails can be comma
separated.

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Vercel

Add these environment variables to the Vercel project and redeploy:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_AUTH_REDIRECT_ORIGIN=https://sherwood-connect.vercel.app`
- `NEXT_PUBLIC_MASTER_EMAIL=hadiabdul8128@gmail.com,sherwoodwallet@gmail.com`
- `GOOGLE_APPS_SCRIPT_WEBHOOK_URL`, if Google Sheets sync is enabled

The publishable key is intended for browser use. Data access is protected by
the row-level security policies in the migration.

## Private spreadsheet mirror

The Supabase database is the source of truth for duplicate prevention. Approved
entries can also be mirrored into a private Google Sheet:

1. Create a Google Sheet that only administrators can access.
2. Add the script from `docs/google-apps-script.js` in **Extensions → Apps Script**.
3. Deploy it as a web app that executes as the sheet owner.
4. Add its `/exec` URL to Vercel as `GOOGLE_APPS_SCRIPT_WEBHOOK_URL`.

The webhook URL stays server-side. Signed-in managers may append approved rows,
but only the master account can read the spreadsheet through the application.

## Docker

```bash
docker compose --env-file .env.local up --build
```

## Checks

```bash
npm run lint
npm run build
docker build .
```
