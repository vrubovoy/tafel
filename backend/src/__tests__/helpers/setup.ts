import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { checkJwksReachable } from '@zudar107/schloss-server-kit'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { sqlite } from './db.js'
import { assertDatabaseCurrent } from '../../db/migrate.js'
import { JWKS_URL } from '../../middleware/auth.js'
import { projectsRouter } from '../../features/projects/router.js'
import { statusesRouter } from '../../features/statuses/router.js'
import { tasksRouter } from '../../features/tasks/router.js'
import { statsRouter } from '../../features/stats/router.js'
import { usersRouter } from '../../features/users/router.js'
import { exportsRouter } from '../../features/exports/router.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(__dirname, '../../db/migrations')

/**
 * Build a minimal Hono app wired up with all feature routers.
 * The db and auth modules are expected to have been mocked by the calling
 * test file before this function is called.
 */
export function createTestApp() {
  const app = new Hono()
  // Mirrors index.ts's real middleware stack, not just the routers - so
  // this exact behavior (body-size limiting) is exercised in tests too.
  app.use('*', bodyLimit({
    maxSize: 1 * 1024 * 1024,
    onError: (c) => c.json({ error: 'Request body too large' }, 413),
  }))
  app.get('/health', (c) => c.json({ status: 'ok', service: 'Tafel' }))
  // Mirrors index.ts's real /ready logic (schema currency, then the
  // Schlüssel JWKS dependency), not a static stub - see the module's own
  // migrations-current setup in helpers/db.ts for why this is meaningful.
  app.get('/ready', async (c) => {
    try {
      assertDatabaseCurrent(sqlite, migrationsFolder)
    } catch {
      return c.json({ status: 'unavailable', service: 'Tafel' }, 503)
    }
    if (!(await checkJwksReachable(JWKS_URL))) {
      return c.json({ status: 'unavailable', service: 'Tafel' }, 503)
    }
    return c.json({ status: 'ready', service: 'Tafel' })
  })
  app.route('/projects', projectsRouter)
  app.route('/statuses', statusesRouter)
  app.route('/tasks', tasksRouter)
  app.route('/stats', statsRouter)
  app.route('/users', usersRouter)
  app.route('/exports', exportsRouter)
  return app
}
