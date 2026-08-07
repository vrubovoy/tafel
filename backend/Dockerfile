FROM node:22-alpine AS builder
WORKDIR /app
# Pinned exactly, matching CI - an unpinned "pnpm" install pulls
# whatever's newest at build time, which broke the build outright once
# (a self-installer bug in 11.12.0), unrelated to any change in this repo.
RUN npm install -g pnpm@11.7.0

# pnpm runs a deps-status check before any "run"/"exec" script (e.g.
# "pnpm exec tsc" below) and, on a mismatch, tries to reinstall - which
# needs interactive confirmation to purge node_modules, and a Docker
# build has no TTY to give it. GitHub Actions sets CI=true for every
# workflow automatically (which is why this never showed up there), so
# it must be set explicitly here.
ENV CI=true

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY schloss-ui/package.json ./schloss-ui/
COPY schloss-server-kit/package.json ./schloss-server-kit/

# better-sqlite3's install script downloads a prebuilt binary and only
# falls back to compiling from source (needs Python + a C/C++
# toolchain, absent from node:22-alpine by default) if that download
# fails - a transient network hiccup then hard-fails the whole build
# instead of just being slower. Installed unconditionally so the rare
# fallback path works instead of erroring out.
RUN apk add --no-cache python3 make g++

# pnpm's frozen-lockfile install verifies/resolves every package in the
# lockfile, not just the current project's own deps, even with --filter
# - since frontend's @zudar107/schloss-ui is part of the same workspace
# lockfile, its package.json (copied above) needs to be present for
# this to resolve, despite the backend never using that package itself.
# No registry involved (it's a workspace:* link to the schloss-ui
# submodule), so no auth needed either. @zudar107/schloss-server-kit
# IS a real backend dependency though (unlike schloss-ui) - included in
# the --filter list below so its own devDependencies (tsup etc.) get
# installed too, needed to build it in the next step.
RUN pnpm install --frozen-lockfile --filter backend --filter @zudar107/schloss-server-kit

# schloss-server-kit is a git submodule, linked via pnpm's workspace:*
# protocol - consumed as its built dist/ output, so its auth and strict
# export-envelope modules need building here before backend imports them
# (same reasoning as frontend's Dockerfile building schloss-ui from source).
COPY schloss-server-kit ./schloss-server-kit
RUN pnpm --filter @zudar107/schloss-server-kit build

COPY backend ./backend
RUN cd backend && pnpm exec tsc --project tsconfig.json

FROM node:22-alpine AS runner
WORKDIR /app
RUN npm install -g pnpm@11.7.0
COPY --from=builder /app/backend/package.json ./backend/
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/
COPY schloss-ui/package.json ./schloss-ui/
COPY schloss-server-kit/package.json ./schloss-server-kit/
# See the builder stage's comment above - same fallback-compile issue.
RUN apk add --no-cache python3 make g++
RUN pnpm install --prod --frozen-lockfile --filter backend --filter @zudar107/schloss-server-kit
# schloss-server-kit is consumed as its built dist/ output (see the
# builder stage) - the --prod install above only links the workspace
# member, it doesn't rebuild it, so the already-built dist/ is copied
# in directly. Its node_modules is ALSO copied from the builder. The shared
# export contract adds jose/zod runtime imports, while hono remains a peer;
# keeping the package's resolved dependency tree beside dist makes all three
# resolve from code executing inside schloss-server-kit. The --prod install
# strips devDependencies workspace-wide, and hono is
# only a peerDependency (relying on the consumer, backend, to supply
# it) - backend's own node_modules/hono doesn't help here, since
# Node's ESM resolution for an import inside
# schloss-server-kit/dist/index.js walks up from schloss-server-kit's
# own directory, not backend's. The builder's non-prod install already
# resolved schloss-server-kit's devDependency-declared hono correctly
# (as a relative symlink into the shared pnpm store), and that same
# store path exists here too, since backend's own real hono dependency
# populates it independently.
COPY --from=builder /app/schloss-server-kit/dist ./schloss-server-kit/dist
COPY --from=builder /app/schloss-server-kit/node_modules ./schloss-server-kit/node_modules
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/src/db/migrations ./backend/dist/db/migrations

EXPOSE 3002
CMD ["node", "backend/dist/index.js"]
