# Release blockers — do not use this prototype for real bank testing yet

This delivery is a branding/UI update to the existing Node.js/SQLite prototype. It is not a bank-production release, a full security remediation, or a completed implementation of every requirement in the discussion. The following were identified from source inspection; this is not an exhaustive security audit.

## Identity and authorization

- `server.js` seeds five well-known demonstration accounts on every start. Passwords use a fixed salt; there is no password-change flow, lockout or bank SSO integration. Replace the demo authentication and remove automatic demo-account creation before any real event.
- Creating an agent/branch participant does **not** create a user account. Add real per-person accounts and an explicit user-to-participant mapping. Currently all AGENT users resolve to A01 and all BRANCH users resolve to B01.
- Assignment-update requests do not enforce ownership of the assignment. Server-side participant/observer scope and role checks must be added and negatively tested.
- QR signatures/expiry are generated, but the scanned participant cookie is not wired into the assignment authorization/view. A working SVG QR is not a completed observer-validation workflow.
- `/api/dashboard` and `/api/events` now require authenticated sessions and read-only Display identities are supported. Bank-approved identity lifecycle, device enrollment, session revocation and network access controls are still required before release.

## Workflow and data correctness

- The QA screen edits defect records, but it does not provide the full observer pending-result validation workflow. Agent case detail/evidence capture and all required outcome controls remain incomplete.
- Status transitions, priority enforcement, evidence requirements, object existence, ownership and concurrent writes need server-side validation.
- Resolving a defect does not synchronize its assignment result. Define and implement the QA/retest state machine before relying on management totals.
- Management totals currently count **assignments**, not distinct imported case IDs. The result overview repeats assignment totals, not independent QA approval totals. Completion percentage includes completed plus resolved assignments. Implement and test the requested all-participants case aggregation.
- Demo assignments are disabled by default and can be enabled only with `SEED_DEMO_DATA=true`. The five known demonstration users and the participant directory are still seeded and must be replaced before a real event.
- There is no managed business testing-session module. The UI's live-update badge indicates the SSE connection, not an approved/open business session or a data-freshness guarantee.
- The go-live target is currently a constant in `summary()` in `server.js`: `2026-10-02T00:00:00+07:00`. The midnight time is an assumption. Confirm the exact time and move it into bank-managed configuration.
- XLSX import now validates the complete workbook atomically and reports row-level errors. Bulk participant/account provisioning, workbook malware scanning and operational import approval remain absent.

## Operational release work

- Replace the fallback signing secret, require HTTPS with Secure cookies, and configure approved internal DNS/network access. The supplied compose file is for local development only.
- Sessions and event clients are in process memory. SQLite is a single-server data store; this source does not include PostgreSQL, Redis, multi-node delivery, HA, or disaster-recovery automation.
- Complete request size/rate limiting, session controls, graceful shutdown, logging, backup/restore, dependency licensing/scanning, penetration testing and load/concurrency testing.
- Test the observer flow with actual phone cameras, expiry, invalid tokens and LAN URLs. A QR pointing to localhost will not work from another device; use the approved internal BASE_URL only after deployment controls are implemented.
- Validate all four screen layouts on the actual displays, data volumes, long names, 200% text enlargement, network interruption and supported mobile browsers. No browser/device acceptance test was run for this branding update.

## Changes included in this update

Original background artwork from the uploaded Wing presentation and a local public-reference logo; shared TV/phone components; local asset routes under the existing CSP; escaped UI data; external click handlers instead of blocked inline handlers; visible connection/error states; clearer assignment metric labels; isolated HTTP smoke tests and this handoff documentation.

These UI changes do not remedy the backend release blockers above. DevOps, application engineering, QA and bank security must resolve and sign off the blockers before using real production data or opening the application to staff.
