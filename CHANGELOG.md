# Changelog

Brief log of notable changes, grouped by theme — not a full commit history
(see `git log` for that). New entries get appended under the section they
fit best; add a new section if none fits.

## Account lifecycle
- Added the durable Schlussel account-deletion consumer, permanent
  reprovisioning tombstones, and atomic purge of all Tafel-owned data.

## Setup
- Initial repo scaffold: AGPL-3.0, governance/issue/PR templates, CI
  (`test.yml`/`publish.yml`), Docker/Caddy setup, mirroring kuvert's own
  conventions. `api/` and `web/` consume the shared `schloss-server-kit`
  and `schloss-ui` submodules from day one instead of duplicating auth/
  CORS/PKCE/API-client/sidebar logic.

## Data model
- `projects` → `statuses` (per-project, user-customizable kanban columns,
  seeded with 3 defaults on project creation) → `tasks` (self-referencing
  `parentTaskId`, arbitrary nesting depth, no schema-level cap). "Done"
  is always `status.isDone`, never a literal status name/id comparison.
- Cycle prevention on reparenting via a recursive CTE walking the
  proposed parent's ancestor chain; recursive cascade-archive of a
  task's whole subtree on delete.
- Recurring tasks (daily/weekly/monthly) regenerate lazily on the next
  `GET /tasks`/`GET /stats/summary` read once the current instance is
  done - no cron/scheduler, transaction-wrapped duplicate check.
- Recurrence is now a continuing series: successors retain cadence and
  parentage, share a stable `recurrenceSeriesId`, and atomically archive
  the completed occurrence before creating the next one. Restoring a
  historical occurrence is rejected when a later member of that series
  already exists.
- Project archive records provenance in `archivedByProject`, allowing
  project restore to revive only tasks hidden by that project operation;
  explicit task archives remain archived. Task restore is recursive and
  requires the project and all ancestors to be active.
- Every timestamp column uses `mode: 'timestamp_ms'` (millisecond
  precision, exact round-trip) rather than the more common
  `mode: 'timestamp'` (seconds, silently truncates precision on every
  read) - both map to the same SQL `integer` column either way.

## API
- Due-date notification candidates are now re-read transactionally immediately
  before outbox deduplication, preventing task, project, status, due-date, or
  owner-timezone edits during a scan from producing stale events. Startup now
  rejects invalid scan/retention intervals and partial Glocke HMAC credentials,
  a persistent occurrence ledger preserves dedupe after terminal outbox
  retention, delivered and permanent retention ages are measured from their
  respective settlement timestamps, cleanup continues in bounded batches even
  without delivery credentials, and graceful shutdown awaits active scans,
  HTTP closure, and dispatcher termination while stopping all owned timers.
- `GET /tasks` drill-in filtering: `parentTaskId=` (empty) → top-level
  only, a real id → that task's direct children, omitted → every depth.
- `GET /projects?archived=true` lists archived projects;
  `POST /projects/:id/restore` and `POST /tasks/:id/restore` expose the
  corresponding provenance-aware restore operations.
- `PUT /tasks/:id/reorder` - dedicated lightweight endpoint for kanban
  drag-and-drop.
- `DELETE /statuses/:id` requires an explicit `?reassignTo=` when tasks
  still reference the status (409 otherwise) - never silently orphans a
  task's status reference.
- Fixed a real bug caught by an independent test-writing agent (working
  from a behavioral spec only, never shown the implementation): every
  `PUT` handler used `<schema>.partial()` for partial updates, but Zod's
  `.default()` fires whenever a key is *absent* from the input
  regardless of `.partial()`/`.optional()` - so any partial update
  omitting a defaulted field silently reset it. For tasks specifically,
  this meant **any partial update that didn't re-send `parentTaskId`
  detached the task from its parent**, and also reset `priority`,
  `dueDate`, `sortOrder`, and both recurrence fields to their defaults.
  Fixed by giving every resource a separate update schema with no
  defaults on any field, so an absent key stays absent and never
  overwrites the existing column.
- Fixed `GET /stats/summary` returning `completedTasks`/`overdueTasks`
  as `null` (not `0`) for a user with no tasks - SQLite's `SUM()` over
  zero matching rows returns `NULL`, which a plain JS destructuring
  default doesn't catch (that only triggers on `undefined`). Wrapped in
  `COALESCE(..., 0)` in the SQL itself.
- Fixed `completedLast14Days`/`currentStreak` never reflecting real
  completions - the day-bucketing SQL divided `completed_at` by 1000
  before passing it to SQLite's `unixepoch` modifier, which is only
  correct for millisecond-precision timestamps; before the
  `timestamp_ms` schema change above, the column was seconds-precision,
  so dividing by 1000 a second time collapsed every real date to right
  around the 1970 epoch, matching nothing in the 14-day window.
- Completion trends, overdue dates, and streak boundaries now use the
  caller's Schlüssel profile timezone (UTC fallback). Streaks walk full
  history rather than stopping at the 14-day chart boundary.
- Status completion transitions have one consistent contract across
  task updates, kanban reorder, status toggles, and status deletion:
  entering done sets `completedAt`, done-to-done preserves it, leaving
  done clears it, and archived task history is not rewritten.
- `GET /users/export` returns all caller-owned Tafel projects, statuses,
  and tasks, including archived data, under the fixed
  `tafel-account-only` scope.
- `GET /exports/me` adds the strict shared version 1 Tafel envelope for normal
  access tokens and exact `hof-service:tafel` export delegations. It scopes
  solely to the verified principal subject and reads the local week-start
  override plus all projects, statuses, tasks, archives, and recurrence history
  in one synchronous SQLite transaction. The legacy `/users/export` response
  remains unchanged; asynchronous all-services ZIP orchestration is owned by
  Schlüssel rather than this endpoint.
- `GET /users/me` now separates effective `weekStartsOn` from nullable
  `weekStartsOnOverride`, while exposing Schlüssel-owned `dateFormat`
  and `timezone` as read-only token values. Sending `null` to
  `PUT /users/me` clears the Tafel override.
- OpenAPI now describes complete entity/export/profile/stat responses,
  exact partial-update bodies, recurrence fields, recursive archive and
  restore conflicts, task-list depth filters, and status-history
  semantics instead of only listing routes.

## Migrations
- Existing graphs survive the nullable week-start table rebuild. Follow-up
  migrations backfill `archivedByProject` for already archived projects
  and seed `recurrenceSeriesId` from each existing recurring task's id.

## Frontend
- The authenticated shared header now links its notification bell to Glocke
  and displays Glocke's unread count using the existing in-memory access token.
  The browser-facing Glocke origin is configured at frontend build time.
- Three views over one task/project data model: a recursive expandable
  list tree, a `@dnd-kit`-based kanban board (columns are the current
  project's own statuses; a card with children shows a progress badge
  and drills into that subtree's own board with a breadcrumb trail
  back up), and a month calendar.
- Shared `TaskFormModal` (create/edit) used by every view.
- The direct settings-page JSON export remains available and now uses the
  shared `DirectExportAction` and `downloadJson` primitives with `/exports/me`.
- Amber accent (`#f59e0b`), distinct from schloss/schlussel/kuvert and
  deliberately not green (the platform's shared "success" color).
