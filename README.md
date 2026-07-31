# Tafel

[![Test](https://github.com/zudaR107/tafel/actions/workflows/test.yml/badge.svg)](https://github.com/zudaR107/tafel/actions/workflows/test.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

Part of the [Schloss platform](https://github.com/zudaR107/Hof).

Tafel ("board" in German) is a personal task/project tracker — projects
containing tasks, tasks nested under other tasks to any depth, viewed as a
list, a calendar, or a drag-and-drop kanban board with per-project custom
statuses.

## How it fits into the platform

Each service is its own repo, named after a German word related to what it does:

- [`schloss`](https://github.com/zudaR107/schloss) — the home page / launcher
- [`schlussel`](https://github.com/zudaR107/schlussel) — auth: accounts, login, tokens
- [`kuvert`](https://github.com/zudaR107/kuvert) — envelope budgeting
- **`tafel`** (this repo) — task/project tracking

Tafel has no login form of its own. An unauthenticated visitor is redirected to
Schlüssel's hosted login page and back; the API verifies the resulting token itself
against Schlüssel's public key (JWKS) rather than calling back to Schlüssel on every
request. Shared logic (JWKS verification, CORS, PKCE login redirect, the API client,
and the resizable sidebar) comes from
[`schloss-server-kit`](https://github.com/zudaR107/schloss-server-kit) and
[`schloss-ui`](https://github.com/zudaR107/schloss-ui), not duplicated here.

This repo is a pnpm workspace with two packages:

- `api/` — the Hono + Drizzle/SQLite backend
- `web/` — the React frontend

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
  list/stats read after completion, no scheduled job) once the current
  instance is marked done.
- **Statistics** — completion rate, overdue count, a 14-day completion trend,
  a streak counter, and a per-project breakdown.
- **API documentation** — an admin-only OpenAPI spec (`GET /openapi.json`) and a Swagger
  UI viewer at `/docs` in the web app, generated from the API's own Zod schemas.

## Local development

```sh
git submodule update --init
pnpm install
pnpm --filter @zudar107/schloss-server-kit build
pnpm --filter @zudar107/schloss-ui build
cp .env.example .env
pnpm dev:api   # API on http://localhost:3002
pnpm dev:web   # web on http://localhost:5175
```

```sh
pnpm --filter api test
pnpm --filter api lint
pnpm --filter web test
pnpm --filter web lint
```

### Environment variables

See `.env.example`. The important ones:

| Variable | Purpose |
|---|---|
| `DATABASE_PATH` | SQLite file path (API) |
| `SCHLUSSEL_JWKS_URL` | Where the API fetches Schlüssel's public key to verify tokens |
| `JWT_ISSUER` | Must match Schlüssel's own issuer, or every token gets rejected |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist (API) |
| `VITE_SCHLUSSEL_URL` | Where "sign in" redirects to (baked in at web build time) |
| `VITE_SCHLOSS_URL` | Where the header's "На главную" link points to (baked in at web build time) |

## Running with Docker

```sh
docker network create schloss-net   # one-time, shared with the other repos
docker compose up -d
```

Neither service publishes a host port — both are reached through the
[tor](https://github.com/zudaR107/tor) gateway (`https://tafel.localhost` in local dev
- tor's Caddy auto-upgrades everything to HTTPS with its own locally-trusted CA), on the
same `schloss-net` network as `schlussel`, `schloss`, and `kuvert`.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
