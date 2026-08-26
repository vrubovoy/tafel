import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { createCorsMiddleware } from '@zudar107/schloss-server-kit'
import { bodyLimit } from 'hono/body-limit'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { sqlite } from './db/index.js'
import { assertDatabaseCurrent, prepareDatabase } from './db/migrate.js'
import { buildInfo } from './build-info.js'
import { projectsRouter } from './features/projects/router.js'
import { statusesRouter } from './features/statuses/router.js'
import { tasksRouter } from './features/tasks/router.js'
import { statsRouter } from './features/stats/router.js'
import { usersRouter } from './features/users/router.js'
import { exportsRouter } from './features/exports/router.js'
import { requireAuth, requireAdmin } from './middleware/auth.js'
import { openApiDocument } from './openapi.js'
import { startNotificationOutbox } from './features/notifications/outbox.js'
import { scanTaskDueNotifications } from './features/notifications/scanner.js'
import { notificationOutboxStartupConfig, positiveIntervalMs } from './config.js'
import { deletionsRouter } from './features/deletions/router.js'

// Resolved relative to this file so it works both in dev (src/index.ts,
// migrations at src/db/migrations) and in the compiled build
// (dist/index.js, migrations at dist/db/migrations) without a hardcoded
// path that only matches one of the two.
const __dirname = dirname(fileURLToPath(import.meta.url))
const DUE_SCAN_INTERVAL_MS = positiveIntervalMs('TAFEL_DUE_SCAN_INTERVAL_MS', 60 * 60_000)
const outboxConfig = notificationOutboxStartupConfig()
prepareDatabase(sqlite, join(__dirname, 'db/migrations'))

const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] ?? 'http://localhost:5175')
  .split(',').map((o) => o.trim())

const app = new Hono()

app.use('*', bodyLimit({
  maxSize: 1 * 1024 * 1024,
  onError: (c) => c.json({ error: 'Request body too large' }, 413),
}))
app.use('*', logger())
app.use('*', createCorsMiddleware({ allowedOrigins: ALLOWED_ORIGINS }))

app.get('/health', (c) => c.json({ status: 'ok', service: 'Tafel', ...buildInfo }))
app.get('/ready', (c) => {
  try {
    assertDatabaseCurrent(sqlite, join(__dirname, 'db/migrations'))
    return c.json({ status: 'ready', service: 'Tafel' })
  } catch {
    return c.json({ status: 'unavailable', service: 'Tafel' }, 503)
  }
})

// Reached from tafel/frontend's own /docs page as /backend/openapi.json
// (the frontend container's Caddyfile already proxies /backend/* here
// with the prefix stripped) - no new reverse-proxy rule needed.
app.get('/openapi.json', requireAuth, requireAdmin, (c) => c.json(openApiDocument))

app.route('/projects', projectsRouter)
app.route('/statuses', statusesRouter)
app.route('/tasks', tasksRouter)
app.route('/stats', statsRouter)
app.route('/users', usersRouter)
app.route('/exports', exportsRouter)
app.route('/internal/v1', deletionsRouter)

const PORT = Number(process.env['PORT'] ?? 3002)
const server = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[Tafel API] Running on http://localhost:${PORT}`)
})

const notificationOutboxRuntime = startNotificationOutbox(outboxConfig)

// Due-date checks don't need per-second freshness like delivery does -
// once an hour (configurable) is plenty for a "due today"/"overdue"
// notification, and the scanner's own dedupe_key makes an extra run
// harmless anyway. Runs once immediately at boot too, rather than only
// after the first interval elapses.
const activeScans = new Set<Promise<void>>()
function runDueScan() {
  const scan = scanTaskDueNotifications()
    .then(() => undefined)
    .catch((err: unknown) => console.error('[Tafel] Task due-date scan failed', err))
  activeScans.add(scan)
  void scan.finally(() => activeScans.delete(scan))
}
runDueScan()
const dueScanTimer = setInterval(runDueScan, DUE_SCAN_INTERVAL_MS)

let shutdownPromise: Promise<void> | undefined
export function shutdown(): Promise<void> {
  shutdownPromise ??= (async () => {
    clearInterval(dueScanTimer)
    const closeServer = new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => error ? reject(error) : resolve())
    })
    await Promise.all([
      Promise.all([...activeScans]).then(() => undefined),
      closeServer,
      notificationOutboxRuntime.stop(),
    ])
  })()
  return shutdownPromise
}
process.once('SIGINT', () => { void shutdown() })
process.once('SIGTERM', () => { void shutdown() })
