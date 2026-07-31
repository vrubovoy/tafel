# Changelog

Brief log of notable changes, grouped by theme — not a full commit history
(see `git log` for that). New entries get appended under the section they
fit best; add a new section if none fits.

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
- Every timestamp column uses `mode: 'timestamp_ms'` (millisecond
  precision, exact round-trip) rather than the more common
  `mode: 'timestamp'` (seconds, silently truncates precision on every
  read) - both map to the same SQL `integer` column either way.

## API
- `GET /tasks` drill-in filtering: `parentTaskId=` (empty) → top-level
  only, a real id → that task's direct children, omitted → every depth.
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

## Frontend
- Three views over one task/project data model: a recursive expandable
  list tree, a `@dnd-kit`-based kanban board (columns are the current
  project's own statuses; a card with children shows a progress badge
  and drills into that subtree's own board with a breadcrumb trail
  back up), and a month calendar.
- Shared `TaskFormModal` (create/edit) used by every view.
- Amber accent (`#f59e0b`), distinct from schloss/schlussel/kuvert and
  deliberately not green (the platform's shared "success" color).
