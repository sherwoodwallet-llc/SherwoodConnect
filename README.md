# Sherwood Connect

Next.js app for Sherwood manager outreach logs. Supabase provides passwordless
email authentication, profiles, outreach logs, realtime updates, and row-level
security. New users are asked for a name and initials after their first login.

## Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor**, paste
   `supabase/migrations/20260620000000_initial_schema.sql`, and run it.
3. In **Authentication → URL Configuration**, set:
   - Site URL: `https://sherwood-connect.vercel.app`
   - Redirect URLs: `http://localhost:3000/**` and
     `https://sherwood-connect.vercel.app/**`
4. Keep email sign-in enabled in **Authentication → Providers → Email**.
5. Copy `.env.example` to `.env.local` and add the project URL and publishable
   key from **Project Settings → API**.

If the master account changes, update both `NEXT_PUBLIC_MASTER_EMAIL` and the
row in `public.app_admins`.

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
- `NEXT_PUBLIC_MASTER_EMAIL=hadiabdul8128@gmail.com`
- `GOOGLE_APPS_SCRIPT_WEBHOOK_URL`, if Google Sheets sync is enabled

The publishable key is intended for browser use. Data access is protected by
the row-level security policies in the migration.

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
