# Disposable Vercel demo

This deployment uses SQLite in memory. Each function instance starts with 150 synthetic cases. Uploads, account creation, tester links and result changes can disappear on restart and differ between instances. Seeded login cookies work across instances; newly created accounts require the instance that created them. Use synthetic/demo files only.

## Deploy

1. Push project to private Git repository, excluding `node_modules`, `data`, `.env` and credentials. `.vercelignore` also excludes database files and backups from deployment.
2. Vercel → Add New → Project → import repository.
3. Framework preset: Other. Node.js version: 24.x. Existing `vercel.json` defines Node Function and routes; no frontend build required.
4. Add `APP_SECRET`: long random value, shared across Preview/Production environments that need same sessions. Generate with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
5. Optional `BASE_URL`: complete HTTPS deployment/custom-domain URL for QR links. Default uses Vercel deployment URL.
6. Deploy. Open deployment URL → sign in.

`api/demo.js` forces demo mode and disables listening socket. Local `npm start` retains persistent file-backed mode. Demo uses HTMX frontend by default. TV pages poll every 10 seconds instead of keeping streaming connections open. Full database replacement/backup endpoint is disabled; channel-specific production uploads remain available, subject to Vercel request limits.

## Seeded logins

| Role | Username | Password |
|---|---|---|
| Administrator | admin | Admin@123 |
| Observer | observer01 | Observer@123 |
| Manager | manager01 | Manager@123 |
| TV display | display01 | Display@123 |
| QA Lead | qalead | QA@123 |
| Technical | tech | Tech@123 |
| Agent | agent01 | Agent@123 |
| Branch | branch01 | Branch@123 |

Observer initially owns A01 and B01. Seeded passwords are public demo credentials, not production credentials.

## Verify

Run `npm run test:demo` for port-free handler checks; `npm test` checks local workflows. After deployment, verify login, CSS/images, Observer tab, channel upload, tester unlink, QA update and TV polling. Hosting deployment itself requires Vercel account/repository connection.
