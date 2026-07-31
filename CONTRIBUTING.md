# Contributing to Tafel

Thanks for considering a contribution. Tafel is a personal task/project
tracker and a pnpm workspace with two packages, `api/` and `web/` —
please keep changes focused.

## Getting set up

```sh
git submodule update --init
pnpm install
cp .env.example .env
pnpm dev:api   # API on http://localhost:3002
pnpm dev:web   # web on http://localhost:5175
```

See the [README](README.md) for environment variables and running the full stack with
Docker alongside `schlussel` and `schloss`.

## Before opening a PR

- Run `pnpm --filter api test`, `pnpm --filter api lint`, `pnpm --filter web test`, and
  `pnpm --filter web lint` — CI runs all four and will block merges that don't pass.
- Add or update tests for any behavior change.
- Keep commits focused; one logical change per PR is easier to review than several
  bundled together.
- Write commit messages that explain *why*, not just *what* — the diff already shows
  what changed.

## Opening a PR

- Branch from `main`.
- Reference the issue you're addressing if one exists (`Closes #123`).

## Reporting bugs / security issues

Open a regular issue for bugs. For anything that looks like a security vulnerability,
please use GitHub's private "Report a vulnerability" flow under this repo's Security tab
instead of a public issue.
