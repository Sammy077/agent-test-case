# Vercel deployment with shared SQLite storage

Vercel uses one shared Turso/libSQL database. Accounts, Observer links, tests and results persist across restarts and function instances. New shared database starts with Administrator only. Local `npm start` uses disk-backed SQLite unless Turso variables are configured.

## Deploy

1. Push project to private Git repository, excluding `node_modules`, `data`, `.env` and credentials. `.vercelignore` also excludes database files and backups from deployment.
2. Vercel → Add New → Project → import repository.
3. Framework preset: Other. Node.js version: 24.x. Existing `vercel.json` defines Node Function and routes; no frontend build required.
4. Add `APP_SECRET`: long random value, shared across Preview/Production environments that need same sessions. Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
5. Create Turso database at https://app.turso.tech. Add `TURSO_DATABASE_URL` (database `libsql://` URL) and `TURSO_AUTH_TOKEN` (database token) to Vercel environment variables. Use separate databases for Preview and Production. Keep tokens out of source control. Deployment fails when shared storage configuration is missing; there is no in-memory fallback.
6. Optional `BASE_URL`: complete HTTPS deployment/custom-domain URL for QR links. Default uses Vercel deployment URL.
7. Deploy. Open deployment URL → sign in.

`api/demo.js` enables signed serverless sessions and disables listening socket. Local `npm start` retains persistent file-backed mode. Vercel uses HTMX frontend by default. TV pages poll every 10 seconds instead of keeping streaming connections open. Full database replacement/backup endpoint is disabled; channel-specific production uploads remain available, subject to Vercel request limits.

## Seeded logins

| Role | Username | Password |
|---|---|---|
| Administrator | admin | Admin@123 |

Initial admin password is public demo credential. Create required accounts and testers through Administration; upload production samples by channel. Observer TV reports cover all testers; editing remains limited to linked testers.

## Local fresh start

Run `npm run reset:local` once, then restart server. Command creates integrity-checked SQLite backup under `data/backups`, preserves existing Administrator credentials, removes tests, participants and non-admin accounts, and records reset. Startup never runs reset or recreates samples. Local disk-backed data imported afterward persists across restarts. `SEED_DEMO_DATA` no longer enables sample records.

## Verify

Run `npm run test:shared` for driver compatibility and cross-process Observer login checks using temporary SQLite fixture; `npm run test:demo` for test-only in-memory handler checks; `npm test` checks local workflows. Shared-driver fixture does not verify hosted Turso connectivity. After configuring real credentials, create Observer through Administration, then verify login across fresh function instances. After deployment, verify login, CSS/images, Observer tab, channel upload, tester unlink, QA update and TV polling. Hosting deployment itself requires Vercel account/repository connection.
