# Sherwood Connect

Next.js app for Sherwood manager outreach logs. Authentication uses Firebase email
links. Manager profiles are loaded through authenticated API routes and cached in
Redis when `REDIS_URL` is configured.

## Local Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.
Copy `.env.example` to `.env.local` and fill in the Firebase values before
testing login.

## Docker

Build-time `NEXT_PUBLIC_*` values are baked into the browser bundle. Export them
or run Compose with an env file when building the image.

```bash
docker compose --env-file .env.local up --build
```

The Compose stack runs the app on port `3000` and Redis on port `6379`.

## Production

Deploy the repo to Railway with the root `Dockerfile`. Add a Railway Redis
database and reference its `REDIS_URL` in the app service. Required app variables:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_AUTH_REDIRECT_ORIGIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `REDIS_URL`
- `GOOGLE_APPS_SCRIPT_WEBHOOK_URL`, if Google Sheets sync is enabled

After Railway assigns the app domain, add that domain to Firebase Auth authorized
domains and set `NEXT_PUBLIC_AUTH_REDIRECT_ORIGIN` to that origin before
rebuilding.

## Checks

```bash
npm run lint
npm run build
docker build .
```
