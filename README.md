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
Schlüssel and refresh the session token.

The completion trend and current streak bucket timestamps by that profile
timezone, falling back to UTC. The 14-day trend includes today and is ordered
oldest to newest. The streak is not capped at 14 days, but it is a current
streak: counting starts today and stops at the first local calendar day with no
completion. Archived completed occurrences remain part of this completion
history even though archived tasks are excluded from active totals.

`GET /users/export` returns every caller-owned project, status, and task,
including archived projects and historical recurring occurrences. Its fixed
scope is `tafel-account-only`; it excludes the account profile and data from
other Hof services.

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
| `SCHLUSSEL_WEB_URL` | Where sign-in redirects; Compose passes it as the frontend build's `VITE_SCHLUSSEL_URL` |
| `SCHLOSS_URL` | Where the header's "На главную" link points; Compose passes it as `VITE_SCHLOSS_URL` |

When running the packages directly instead of through Compose, defaults support
the standard local ports. Override them with `DATABASE_PATH`, `ALLOWED_ORIGINS`,
`SCHLUSSEL_JWKS_URL`, `JWT_ISSUER`, `VITE_SCHLUSSEL_URL`, and
`VITE_SCHLOSS_URL` on the respective process. The names above are the host-side
Compose configuration used by `.env.example`; `VITE_*` values are fixed at
frontend build time.

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

## License

AGPL-3.0 — see [LICENSE](LICENSE).
