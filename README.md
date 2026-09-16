# Production Test Center — Wing-branded source

**Developer prototype, not approved for bank production use.** This ZIP contains editable source, not a compiled/locked application. It updates the existing Node.js 24 / SQLite prototype with the original green-to-blue background from the user's uploaded `POS_Final_Presentation.pptx`, a public-reference Wing logo, shared colour settings and responsive screen styling. It does not convert the prototype into the previously discussed Java/PostgreSQL/Keycloak architecture.

Start with **PRODUCTION-GAPS.md** for release blockers and **BRANDING.md** for colours, assets and layout settings. Do not use real customer data or publish this demonstration service.

## Files to modify

| File | Purpose |
| --- | --- |
| public/brand.css | Central colours, font stack and slide background configuration |
| public/brand-background.png | Original 1920 × 1080 background from the uploaded Wing presentation |
| public/style.css | Responsive layout and all UI components |
| public/wing-logo.svg | Locally bundled, public-reference Wing logo |
| lib/htmx-views.js | Server-rendered pages and reusable HTMX fragments |
| public/htmx-client.js | Minimal CSRF, countdown and SSE connection helpers |
| public/vendor/ | Locally pinned HTMX and extension assets |
| public/app.js / public/index.html | One-release legacy rollback frontend |
| server.js | Backend, database migrations, access checks, Excel import, QR and live events |
| test.js | Isolated HTTP smoke checks |
| Dockerfile / docker-compose.yml | Existing local development container examples |

No public hosting is required. Application assets are served from the same internal server; there are no external fonts, QR providers, CDNs or analytics.

## Local developer run

Prerequisite: **Node.js 24 or later**, including the built-in node:sqlite module. Earlier Node versions cannot run this source. ExcelJS is installed from the lockfile for workbook import; the QR implementation remains vendored.

From the extracted directory:

~~~bash
node --version
npm ci
npm test
~~~

For local development on Linux/macOS:

~~~bash
HOST=127.0.0.1 BASE_URL=http://127.0.0.1:8080 npm start
~~~

For local development on Windows PowerShell:

~~~powershell
$env:HOST = "127.0.0.1"
$env:BASE_URL = "http://127.0.0.1:8080"
npm start
~~~

Open http://127.0.0.1:8080/login on the same machine. The application creates its database under data/. New databases start without test cases; set `SEED_DEMO_DATA=true` only for an explicit demonstration dataset. Tests use a separate temporary database and bind only to loopback.

Server-rendered HTMX is the default frontend. Set `FRONTEND_MODE=legacy` before startup for the temporary SPA rollback path. HTMX 2.0.10, SSE 2.2.4 and Response Targets 2.0.4 are pinned under `public/vendor/`; production runtime needs no CDN access. Existing `/api/*` JSON contracts remain available.

Docker is optional; docker compose up --build uses the included development configuration. That configuration binds a server port and contains demonstration defaults. Do not expose it to staff networks or production until the documented release blockers have been fixed.

## Separate URLs

| View | URL path |
| --- | --- |
| Management — 85-inch TV target | /tv/management |
| Technical & QA TV | /tv/technical |
| Agents — 55-inch TV target, 20 tiles | /tv/agents |
| Branches — 55-inch TV target, 10 tiles | /tv/branches |
| Individual participant queue | /my-tests |
| Administration / Excel import / accounts / participant QR links | /admin |
| QA / technical defect editor | /qa |
| Sign-in | /login |

Technical details require a QA/technical sign-in. Management and TV data require an Admin, Manager or Display session; Display accounts are read-only. Display sizes describe intended layouts, not completed physical-device acceptance tests. See BRANDING.md for viewport assumptions.

## Demonstration accounts only

| Role | Username | Password |
| --- | --- | --- |
| Admin | admin | Admin@123 |
| QA lead | qalead | QA@123 |
| Technical | tech | Tech@123 |
| Agent A01 | agent01 | Agent@123 |
| Branch B01 | branch01 | Branch@123 |

These known defaults are automatically seeded in server.js and must be removed/replaced by the development team. Administrators can create and deactivate Manager and Display accounts; there is still no password-change or participant-account provisioning flow. Creating a participant does not create a login.

## Test-case import

Manual case creation remains absent. Administration accepts `.xlsx` workbooks following the production channel sheets. Case assignment is managed separately in Administration; participant code is not required in imported workbooks. Priority uses 1=Critical, 2=High, 3=Medium and 4=Low.

Complete workbook validation precedes atomic import. Production identity = channel + classification sheet + source Case ID; repeated IDs across classifications remain independently assignable. Each classified case allows one assigned participant; participants can receive many cases. `Group` + `MasterSheet` remain reference sheets, excluded from import and reported in import summary. Repeat imports refresh case metadata + source details while preserving assignments and saved execution/QA results. Administrators assign or reassign cases while status is Not Started. In **Test case assignments**, choose **Assignable only**, select cases, choose agent, then assign selected cases. Previous/Next navigate larger lists. Bulk requests remain atomic: started cases prevent entire reassignment.

Optional workbook columns `Category` + `Type` import as nullable text, separate from existing `Case Type`. `Main Feature` + `Sub Feature` persist for filtering; existing records backfill from stored source details. Test details promote exact `Master`, `Commission`, `Fee` values, including zero; tier-specific Commission/Fee duplicates remain stored but hidden.

Administrator case assignments + Observer **My Tests** support **Sort By**: Default, Case ID, Channel, Classification, Scenario, Priority, Assigned User, Main Feature, Sub Feature. **Order By** selects Ascending/Descending; Default retains existing ordering. Sorting runs server-side before existing pagination; blank values remain last. Observer **My Tests** additionally filters by Priority, Main Feature, Sub Feature alongside Channel; selected filters combine using AND within linked-tester scope. URLs preserve selections through reloads/actions. Clear filters preserves selected tester + sorting.

Participant QR links create an eight-hour participant-scoped session and open that participant's complete assigned test-case queue. The session cannot update another participant's assignments.

After starting a case in **My Tests**, an Agent or Branch selects Passed, Failed or Blocked, adds an optional Note (up to 2,000 characters), and submits it to QA. The assignment remains Pending QA and continues to count as pending on management dashboards. **QA & Technical → Pending verification** lets QA approve the reported result or return it for retesting. Only approval converts Passed to Completed, Failed to Failed (and creates or reopens a defect), or Blocked to Blocked.

## Go-live and live status

The existing target is 2 October 2026 at **00:00 Phnom Penh time (UTC+07:00)**. The date was requested; the time is an assumption for confirmation. Edit the goLive value in summary() in server.js until a managed configuration module is implemented.

The TV live badge reflects the authenticated event-stream connection. It is not a managed testing-session status. Management totals remain assignment totals, with overall and per-channel QA/result comparisons. Finance status is informational and is not counted as QA completion.

## Verification scope

npm test checks protected dashboard access, Manager/Display roles, direct Excel import and repeat-import reconciliation, one-agent-per-case assignment, participant QR queue access, atomic row validation, channel summaries and filters, UI markers, route delivery and CSP-safe assets.

`npm run test:cases` checks classified import identity, reference exclusions, optional metadata, safe reimport, legacy database migration, both case renderers, scoped Observer filters, every sort field/direction, blanks/ties, pagination, and action return state.

It does **not** prove camera-level QR scanning, complete observer/QA workflows, responsiveness on the physical TVs, load capacity or production readiness. Read PRODUCTION-GAPS.md before planning any production release.

### Observer tester management

Observer accounts receive Observer tab (`/observer`), My Tests, and QA workspace. Observers claim unassigned active Agent/Branch testers; each tester belongs to one Observer. Assigned tests support tester/channel filters and 50-row pagination. Unlink removes Observer access immediately without deleting tester accounts, assignments, results, or defects. QA review, execution, defect updates, and channel lists cover linked active testers only.

Administrator can create empty Observer accounts or choose optional initial tester. Existing single-tester Observer links migrate automatically into `observer_participants`; Observer `users.participant_id` becomes null. Migration runs transactionally and stops on conflicting ownership. Restart never restores removed links. Free-text Observer names remain descriptive.

### Production sample upload by channel

Administration → Import production sample · Excel → enter Channel name → choose `.xlsx` → Validate and import. Every imported case uses entered channel; worksheet names remain subcategories. Existing channel spelling matches without case sensitivity. Reuploads update case definitions by channel/worksheet/source Case ID, preserve existing assignments and saved execution/QA results, and leave absent cases and other channels intact. New cases start unassigned with imported production status. 

### My Agent rounds

Administrators can open **My Agent** to view `Round Plan Testing(1).numbers`: seven scenarios and seven rounds for seven testers (A01–A07). All seven cards display assigned Cash Out scenario, instructions, scenario and instructions. Round 1 appears immediately. **Next Round** changes the displayed round without completion gates. Round 7 loops back to Round 1. No status, progress, completion buttons, or results tracking. **Workbook Schedule** displays the full reference matrix. Existing testing results remain saved separately.

Run `npm run test:agent-loop` for workbook mapping, unrestricted navigation, stale requests, and final-round behavior.

Run `npm run test:my-agent` for round creation, rotation, stale/repeated requests, access control, result preservation, workbook protection, and replacement/reset compatibility.

My Agent separates seven amount rounds from seven rotation steps. Back/Next Step rotates scenarios while transaction values stay fixed. Next Round becomes available at Step 7 and starts Step 1 with next round’s values; Round 7 wraps to Round 1. Back Round returns previous amount round at Step 1. Navigation includes round and step to reject stale requests.
