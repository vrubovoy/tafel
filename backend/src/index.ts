import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { createCorsMiddleware } from '@zudar107/schloss-server-kit'
import { bodyLimit } from 'hono/body-limit'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from './db/index.js'
import { projectsRouter } from './features/projects/router.js'
import { statusesRouter } from './features/statuses/router.js'
import { tasksRouter } from './features/tasks/router.js'
import { statsRouter } from './features/stats/router.js'
import { usersRouter } from './features/users/router.js'
import { requireAuth, requireAdmin } from './middleware/auth.js'
import { openApiDocument } from './openapi.js'

// Resolved relative to this file so it works both in dev (src/index.ts,
// migrations at src/db/migrations) and in the compiled build
// (dist/index.js, migrations at dist/db/migrations) without a hardcoded
// path that only matches one of the two.
const __dirname = dirname(fileURLToPath(import.meta.url))

migrate(db, { migrationsFolder: join(__dirname, 'db/migrations') })

const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? 'http://localhost:5175')
  .split(',').map((o) => o.trim())

const app = new Hono()

app.use('*', bodyLimit({
  maxSize: 1 * 1024 * 1024,
  onError: (c) => c.json({ error: 'Request body too large' }, 413),
}))
app.use('*', logger())
app.use('*', createCorsMiddleware({ allowedOrigins: ALLOWED_ORIGINS }))

app.get('/health', (c) => c.json({ status: 'ok', service: 'Tafel' }))

// Reached from tafel/frontend's own /docs page as /backend/openapi.json
// (the frontend container's Caddyfile already proxies /backend/* here
// with the prefix stripped) - no new reverse-proxy rule needed.
app.get('/openapi.json', requireAuth, requireAdmin, (c) => c.json(openApiDocument))

app.route('/projects', projectsRouter)
app.route('/statuses', statusesRouter)
app.route('/tasks', tasksRouter)
app.route('/stats', statsRouter)
app.route('/users', usersRouter)

const PORT = Number(process.env['PORT'] ?? 3002)
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[Tafel API] Running on http://localhost:${PORT}`)
})
