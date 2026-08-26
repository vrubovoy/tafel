# Tafel

[![Test](https://github.com/zudaR107/tafel/actions/workflows/test.yml/badge.svg)](https://github.com/zudaR107/tafel/actions/workflows/test.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

Part of the [Hof platform](https://github.com/zudaR107/Hof) — a suite of
self-hosted personal services:

- [`schloss`](https://github.com/zudaR107/schloss) — home page / launcher
- [`schlussel`](https://github.com/zudaR107/schlussel) — auth: accounts, login, tokens
- [`kuvert`](https://github.com/zudaR107/kuvert) — envelope budgeting
- **`tafel`** (this repo) — task/project tracking
- [`zettel`](https://github.com/zudaR107/zettel) — markdown note-taking
- [`glocke`](https://github.com/zudaR107/glocke) — in-app notification center and delivery foundation
- [`schrank`](https://github.com/zudaR107/schrank) — file storage with nested folders
- [`herold`](https://github.com/zudaR107/herold) — webmail client for external IMAP/SMTP accounts
- [`wachter`](https://github.com/vrubovoy/wachter) — server resource monitoring
- [`tor`](https://github.com/zudaR107/tor) — reverse-proxy gateway
- [`schloss-ui`](https://github.com/zudaR107/schloss-ui) — shared frontend components
- [`schloss-server-kit`](https://github.com/zudaR107/schloss-server-kit) — shared backend auth/CORS kit

Tafel ("board" in German) is a personal task/project tracker — projects
containing tasks, tasks nested under other tasks to any depth, viewed as a
list, a calendar, or a drag-and-drop kanban board with per-project custom
statuses.

## How it fits into the platform

Tafel has no login form of its own. An unauthenticated visitor is redirected to
Schlüssel's hosted login page and back; the backend verifies the resulting token itself
against Schlüssel's public key (JWKS) rather than calling back to Schlüssel on every
request. Shared logic (JWKS verification, CORS, PKCE login redirect, the API client,
and the resizable sidebar) comes from
[`schloss-server-kit`](https://github.com/zudaR107/schloss-server-kit) and
[`schloss-ui`](https://github.com/zudaR107/schloss-ui), not duplicated here.

This repo is a pnpm workspace with two packages:

- `backend/` — the Hono + Drizzle/SQLite backend
- `frontend/` — the React frontend

## Features

- **Projects** — named, colored containers for tasks, each with its own set of
  kanban statuses (seeded with To Do/In Progress/Done, fully customizable:
  rename, recolor, reorder, add, remove).
- **Tasks & subtasks** — arbitrary nesting depth (a subtask can itself have
  subtasks), with cycle prevention (a task can never become a subtask of its
  own descendant) and a recursive completion-progress rollup.
- **Three views over the same data**:
  - **List** — a recursive, expandable/collapsible tree.
  - **Kanban** — columns are the current project's own statuses; a card with
    children shows a progress badge and can be "drilled into" to view/reorder
    just that subtree on its own board, with a breadcrumb trail back up.
  - **Calendar** — a month grid with task chips on their due date.
- **Recurring tasks** — daily/weekly/monthly, regenerated lazily (on the next
  list/stats read after completion, no scheduled job) once the next occurrence
  is due. Every occurrence keeps the cadence, parent, and a stable series id;
  the completed occurrence is retained in the archive.
- **Statistics** — completion rate, overdue count, a 14-day completion trend,
  a streak counter, and a per-project breakdown. Calendar-day calculations use
  the timezone from the Schlüssel profile token (UTC when it is unset).
- **Archive and export** — project archive/restore with task-tree provenance,
  recursive task archive/restore endpoints, and a JSON export scoped to the
  caller's Tafel data (including archived records).
- **API documentation** — an admin-only OpenAPI spec (`GET /openapi.json`) and a Swagger
  UI viewer at `/docs` in the frontend app, generated from the backend's own Zod schemas.
- **Due-date notifications** — a background scanner emits one `tafel.task.due.v1`
  event per task the moment it becomes due, and again once when it becomes
  overdue, computed in the task owner's own timezone (mirrored locally from the
  Schlüssel token on each request, UTC if never seen). Events are queued in a
  transactional outbox and delivered to [`glocke`](https://github.com/zudaR107/glocke),
  the platform's notification service; there is no new HTTP endpoint on Tafel's
  own API for this — it is outbound-only. Each candidate is revalidated inside
  the insert transaction so edits made during a scan cannot enqueue stale
  notifications. A separate persistent occurrence ledger retains dedupe
  identities after old delivered and permanently failed outbox rows are pruned
  in bounded batches; pending and in-flight delivery rows are retained.

## Behavioral contracts

### Recurrence and completion

Recurrence is a series, not a one-shot copy. `recurrenceSeriesId` remains stable
across generated occurrences, while `recurrenceAnchorDate` advances by
`recurrenceCount` days, weeks, or months. A completed occurrence is advanced
only when its next anchor is due and either `GET /tasks` or
`GET /stats/summary` runs. The old occurrence is archived and exactly one
successor is placed in the project's first non-done status. A recurring
subtask remains attached to its parent.

Done state is defined by the current status's `isDone` flag. Entering a done
status sets `completedAt`; moving between done statuses preserves it; returning
to a non-done status clears it. Changing a status's `isDone` flag applies the
same state to active tasks in that status, while archived occurrences retain
their historical `completedAt`. Tafel does not keep a separate status-event
log.

### Trees, boards, and ordering

Task nesting is unbounded and cycle-checked. The list renders the complete
recursive tree. Kanban renders one sibling level at a time: roots at the
project board, or direct children after drilling into a task. Progress badges
roll up all descendants, breadcrumbs include every ancestor, and drag ordering
is scoped to tasks sharing both a parent and a status.

The task-list API mirrors those views: omit `parentTaskId` for every depth, use
an empty `parentTaskId=` for roots only, or pass an id for that task's direct
children. `from` and `to` due-date filters are inclusive.

### Archive and restore

Archiving a task recursively archives its whole subtree. Restoring it also
walks the subtree, but requires an active project and active ancestors first.
Historical recurring occurrences are not restored when a later occurrence in
the same series exists, preventing a restored branch from forking the series.

Archiving a project hides the project and marks only tasks that were active at
that moment as project-archived. Restoring the project revives those tasks;
tasks archived explicitly before the project remain archived. Archived
projects are listed with `GET /projects?archived=true`.

### Profile, dates, and export

`GET /users/me` distinguishes the effective calendar week start
(`weekStartsOn`) from Tafel's nullable local override
(`weekStartsOnOverride`). A local value wins, then the Schlüssel profile's
platform-wide value, then Monday. `PUT /users/me` accepts `0` (Sunday), `1`
(Monday), or `null` (clear the local override). `dateFormat` and `timezone` are
read-only in Tafel and come from the current Schlüssel token; update them in
Schlüssel and refresh the session token. `timezone` is additionally mirrored
into the local user row on every request (coalesced, never cleared by a token
that lacks the claim) so the due-date notification scanner — which runs on a
timer, with no request or token in scope — can still evaluate "due today" per
task owner rather than in server-local time.

The completion trend and current streak bucket timestamps by that profile
timezone, falling back to UTC. The 14-day trend includes today and is ordered
oldest to newest. The streak is not capped at 14 days, but it is a current
streak: counting starts today and stops at the first local calendar day with no
completion. Archived completed occurrences remain part of this completion
history even though archived tasks are excluded from active totals.

`GET /exports/me` is the standardized synchronous JSON export used by Tafel's
direct download action and as an input to Schlüssel's separate platform ZIP
orchestration. It returns the strict version 1 envelope (`version`, `service`,
`exportedAt`, and `data`) with the nullable Tafel-local `weekStartsOn` override
plus every subject-owned project, status, and task, including archived rows and
historical recurring occurrences. All local data is read in one synchronous
SQLite transaction so the response represents one consistent snapshot.

The endpoint accepts either a normal Schlüssel access token or a short-lived
export delegation with the exact `hof-service:tafel` audience and
`data:export` scope, `token_use: export`, and nonempty subject, job, and token
IDs plus a non-expired numeric `exp`, verified through the configured JWKS and
exact issuer. Delegations are restricted to `/exports/me`, and the snapshot is
always scoped to the verified principal subject. Ordinary API routes continue
to require a full access token. Export responses are private, no-store, and
nosniff.

The existing `GET /users/export` endpoint remains available for direct clients
with its legacy top-level response (`scope: tafel-account-only`, `exportedAt`,
`projects`, `statuses`, and `tasks`). It excludes profile data and data from
other Hof services.

Only Schlüssel's asynchronous `/export-jobs` API creates an all-services ZIP.
Each service takes its local snapshot when called, so files can have different
timestamps and the archive is not a distributed point-in-time transaction.
Retries preserve successful files and capture failed services later. If at
least one service succeeds and at least one fails, a partial ZIP remains
available; `manifest.json` records statuses, attempts, timestamps, byte counts,
SHA-256 checksums, file names, and sanitized failures.

Schlüssel's ZIP is an authenticated, owner-only, no-store download with a
short artifact TTL (24 hours by default), per-user cooldown and retained-job/
byte limits, response-size bounds, a global storage quota, and a free-space
reserve. Export files contain sensitive task content. Tafel exports its local
week-start override and caller-owned project/status/task graph only; it excludes
account credentials and tokens, server configuration and logs, internal worker
or audit state, other users, and other services' data.

## Local development

```sh
git submodule update --init
pnpm install
pnpm --filter @zudar107/schloss-server-kit build
pnpm --filter @zudar107/schloss-ui build
pnpm dev:backend    # API on http://localhost:3002
pnpm dev:frontend   # frontend on http://localhost:5175
```

```sh
pnpm --filter backend test
pnpm --filter backend lint
pnpm --filter frontend test
pnpm --filter frontend lint
```

### Environment variables

`.env.example` contains the host-side variables consumed by Docker Compose:

| Variable | Purpose |
|---|---|
| `TAFEL_DATABASE_PATH` | SQLite file path; Compose maps it to the backend's `DATABASE_PATH` |
| `SCHLUSSEL_JWKS_URL` | Where the backend fetches Schlüssel's public key to verify tokens |
| `JWT_ISSUER` | Must match Schlüssel's own issuer, or every token gets rejected |
| `TAFEL_ALLOWED_ORIGINS` | Comma-separated CORS allowlist; Compose maps it to the backend's `ALLOWED_ORIGINS` |
| `SCHLUSSEL_WEB_URL` | Where sign-in redirects; the frontend container writes it to runtime `/config.js` at startup |
| `SCHLOSS_URL` | Where the header's "На главную" link points; written to runtime `/config.js` |
| `GLOCKE_URL` | Browser-facing Glocke origin for the header notification bell and unread-count request; written to runtime `/config.js` along with a derived `services.glocke` flag - leaving it unset hides the bell entirely instead of pointing it at a dev default |
| `GLOCKE_BASE_URL` | Where the notification outbox delivers events; unset in Compose defaults to `http://glocke-backend:3004` |
| `TAFEL_TO_GLOCKE_HMAC_KEY_ID` | Key id Tafel signs outbound Glocke requests with |
| `TAFEL_TO_GLOCKE_HMAC_SECRET` | Must match Glocke's own `GLOCKE_SOURCE_SECRET_TAFEL` exactly; leaving both HMAC variables unset queues events without delivery, while configuring only one is a startup error |
| `GLOCKE_OUTBOX_RETENTION_MS` | Retention for delivered and permanently failed outbox rows (default seven days); cleanup is limited to 100 rows per hourly-or-faster pass and continues when delivery credentials are absent |
| `TAFEL_DUE_SCAN_INTERVAL_MS` | How often the due-date scanner runs (default one hour); it also runs once immediately at boot |

Scan and retention intervals must be positive integer milliseconds no greater
than `2147483647`; invalid values fail startup before the HTTP server or workers
start. Graceful shutdown stops new scans and awaits the active scan, HTTP server
close, and notification dispatcher.

Normal and delegated export tokens use the same `SCHLUSSEL_JWKS_URL` and
`JWT_ISSUER`; the Tafel delegation audience is fixed by the service as
`hof-service:tafel`. The shared auth version used here requires ordinary JWTs
to carry `token_use: access`. Deploy the matching Schlüssel issuer change and
allow previously issued access tokens to expire before deploying this version.

When running the packages directly instead of through Compose, defaults support
the standard local ports. Override backend settings with `DATABASE_PATH`,
`ALLOWED_ORIGINS`, `SCHLUSSEL_JWKS_URL`, and `JWT_ISSUER`. For direct frontend
development, edit `frontend/public/config.js`; it is loaded synchronously before
the application bundle. Frontend URL values must be HTTP(S) origins without
credentials, paths, queries, or fragments. Container values are read at startup,
so the same image can be deployed with different browser origins.

### Database migrations

The backend runs pending Drizzle migrations automatically before it starts
serving requests. Upgrades preserve the existing user/project/status/task
graph, make the Tafel week-start override nullable, mark tasks belonging to an
already archived project as project-archived, and initialize each existing
recurring task as its own recurrence series. Back up the SQLite volume before
upgrading, as with any stateful deployment.

## Running with Docker

```sh
docker network create schloss-net   # one-time, shared with the other repos
cp .env.example .env
docker compose up -d
```

Neither service publishes a host port — both are reached through the
[tor](https://github.com/zudaR107/tor) gateway (`https://tafel.localhost` in local dev
- tor's Caddy auto-upgrades everything to HTTPS with its own locally-trusted CA), on the
same `schloss-net` network as `schlussel`, `schloss`, and `kuvert`.

## Operations

Run `pnpm build && pnpm db:migrate` as a dedicated deployment step. Normal startup never changes the database: unset, empty, or `false` `MIGRATE_ON_STARTUP` asserts that all migrations are applied; only explicit `true` migrates on startup. `pnpm db:migrate:dev` retains the Drizzle Kit workflow for development only.

`GET /health` is liveness and reports `version`/`build`; `GET /ready` verifies the current database schema. Set bounded `SERVICE_VERSION` and `BUILD_SHA` metadata (Compose: `TAFEL_SERVICE_VERSION` and `TAFEL_BUILD_SHA`), or the package version and `unknown` are used.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
