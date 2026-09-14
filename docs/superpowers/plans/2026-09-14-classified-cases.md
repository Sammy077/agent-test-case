# Classified Cases Implementation Plan

Approved spec = user implementation request, 2026-09-14.

Goal: classification-aware case metadata, scoped Observer filters, Administrator/Observer sorting.
Architecture: retain durable production identity; centralize allowlisted SQL sorting/filtering; persist optional metadata on cases; render controls in HTMX + legacy clients.
Tech stack: Node 24, SQLite/libsql, ExcelJS, HTMX, browser JavaScript.

- [x] Metadata: add failing workbook/import tests; exclude reference sheets; persist Category/Type/Main Feature/Sub Feature; refresh source metadata without touching execution; backfill legacy details.
- [x] Queries: add HTTP tests for scoped filters, every sort direction, blanks/ties/pagination/invalid input; implement shared query helpers and endpoint/page integration.
- [x] Views: test actual rendered controls/details; add scoped Observer dropdowns, sorting, classification labels and promoted financial details in both clients; preserve query state through forms and pagination.
- [x] Verify: run new tests, existing regression suite, syntax/diff checks, attached-workbook parsing; inspect changed behavior and resolve failures.

Defaults: single-select filters, exact feature matching, text case-insensitive sorting, blanks last, record ID ascending ties; no workbook edits or metadata editing UI.
