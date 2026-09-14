# Multiple users per classified case

Approved behavior: additive assignments, independent results, no duplicate case/user pair, explicit removal, preserve existing records.

1. Add regression coverage proving two users can receive one classified case without replacing execution; verify duplicate prevention, removal restrictions, imports and case-level pagination.
2. Migrate assignment uniqueness from case alone to case/user. Preserve assignment IDs, all workflow/source columns and defect references. Run migration on startup for existing SQLite/Turso databases.
3. Implement transactional additive single/bulk assignment and explicit removal of unstarted assignments. Clone source metadata into new independent executions. Reimport updates source metadata across all assignments.
4. Keep Administrator API and page queries at one row per case. Return assigned user lists, count distinct cases, retain authorized Observer scope and stable sorting before pagination.
5. Update HTMX and legacy assignment controls to add users, list existing users/results and offer removal only before execution. Remove reassignment confirmation wording.
6. Run migration, import, assignment, filter/sort and application checks; review changes, commit and push main as requested.
