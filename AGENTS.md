# AGENTS.md

Working rules for AI agents and contributors working in this repository.

## Project Rules

- Inspect the existing project before making changes.
- Reuse existing components and styling conventions.
- Make coordinated changes across all affected files.
- Do not overwrite unrelated code or create duplicate components.
- Explain the implementation plan before starting.
- Automate routine, reversible file edits and safe development commands when permitted.
- Ask for approval before deleting files, installing unfamiliar packages, changing configuration, or running destructive commands.
- Never expose API keys, passwords, or environment secrets.

## Workflow

1. Inspect the project structure.
2. Identify the files that need changes.
3. Implement the requested feature across those files.
4. Run available lint and build checks.
5. Fix errors caused by your changes.
6. Summarize the files changed, tests performed, and any remaining issues.

---

## Project Specifics

*Added context so steps 4 and 5 of the workflow can actually be carried out. Everything
below was verified against this codebase; delete this section if you would rather keep
the file to the rules alone.*

### Stack

| Layer    | Choice                                                        |
| -------- | ------------------------------------------------------------- |
| Backend  | Laravel (PHP), Sanctum bearer-token auth                       |
| Frontend | React SPA, built with Vite, served by `resources/views/app.blade.php` |
| Tests    | Pest (PHPUnit under the hood)                                  |
| Database | MySQL/MariaDB in development (`eventease`); tests use in-memory SQLite |

### Commands

```bash
# Test suite — the primary check. Run this after every change.
php artisan test

# A single feature file, or one test by name
php artisan test --filter=CertificateGenerationTest
php artisan test --filter="a certificate can be downloaded"

# Frontend build — the only JS check that exists. There is NO JS test runner
# configured (package.json exposes only build and dev), so this build passing
# is the whole of frontend verification.
npm run build

# Dev server
php artisan serve            # http://127.0.0.1:8000
```

There is no separate linter configured (`composer.json` / `package.json` define no
`lint` script), so do not invent one — `php artisan test` and `npm run build` are the
available checks.

### Layout and conventions worth knowing before editing

- `app/Http/Controllers/Api/` — one controller per resource. They return
  `response()->json(...)` directly; there is no FormRequest layer, so validation lives
  inline via `$request->validate()`.
- `app/Services/` — business rules that do not belong in a controller:
  `EventAudience` (course-targeted auto-registration), `CertificateEligibility`
  (who qualifies for a certificate), `CertificateRenderer` (PDF output).
- `resources/js/lib/api.js` — the single API client. Every call goes through `request()`,
  `certificatesApi`, `checkinApi`, etc. Do not call `fetch` directly from a component.
- `resources/js/components/` — shared UI. Icons live in `Icons.jsx` as `export const
  Icon*` arrow components; check there before adding a new one.
- Per-page CSS sits beside each screen (`Events.css`, `Certificates.css`) and is imported
  by the matching `.jsx`. There is no utility framework — plain CSS with `ui.css` holding
  shared primitives.

### Things that will bite you

- **`EnsureRole` gates on HTTP verb.** `GET` is checked against a resource's `read` list
  and everything else against `write`. Adding a read-style endpoint as a `GET` will
  silently inherit the permissions of the existing index route. Read
  `app/Http/Middleware/EnsureRole.php` before adding access-sensitive routes.
- **Soft deletes plus plain `unique()` indexes.** `user_accounts`, `registrations`,
  `certificates` and `events` all use `SoftDeletes` while their unique indexes still
  cover deleted rows. Validation scoped with `Rule::unique(...)->whereNull('deleted_at')`
  is necessary but NOT sufficient — the insert will still hit the index. The pattern
  used in this codebase is to revive the trashed row
  (`UserAccount::withTrashed()->where(...)->first()` then `restore()`), never to insert
  a replacement row.
- **`Rule::unique()` takes exactly two constructor arguments.** Extra arguments are
  silently discarded by PHP, so a mis-built rule fails open rather than erroring. Always
  use the fluent `->whereNull()` / `->ignore()` form.
- **Denormalised event titles.** `registrations`, `certificates` and
  `certificate_templates` store `event` (the title) *and* `event_id`. The
  `add_event_id_to_event_scoped_tables` migration backfills `event_id` by title match, so
  renaming an event leaves orphaned rows with a null `event_id`. Writes that set
  `event_id` must use `forceFill()`, because it is intentionally absent from
  `$fillable`.
- **Queued work needs a worker.** `QUEUE_CONNECTION=database`, and nothing is consumed
  unless `php artisan queue:work` is running. A job that appears "Queued" with an empty
  `jobs` table usually means nothing is consuming it. `MAIL_MAILER=log` in development,
  so mail is written to `storage/logs/laravel.log` rather than delivered.
