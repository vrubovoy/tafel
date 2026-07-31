import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { projectsRouter } from '../../features/projects/router.js'
import { statusesRouter } from '../../features/statuses/router.js'
import { tasksRouter } from '../../features/tasks/router.js'
import { statsRouter } from '../../features/stats/router.js'
import { usersRouter } from '../../features/users/router.js'

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
  app.route('/projects', projectsRouter)
  app.route('/statuses', statusesRouter)
  app.route('/tasks', tasksRouter)
  app.route('/stats', statsRouter)
  app.route('/users', usersRouter)
  return app
}
