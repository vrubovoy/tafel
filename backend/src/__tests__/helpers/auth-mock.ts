import { createMiddleware } from 'hono/factory'

// Mirrors the real middleware/auth.ts export - readiness tests set
// SCHLUSSEL_JWKS_URL before importing anything so this points at a real
// (or deliberately failing) test server instead of the production
// default. Needed here too, not just the real file, since helpers/setup.ts
// imports JWKS_URL from '../../middleware/auth.js', which vi.mock
// redirects to this module for the whole test run.
export const JWKS_URL = process.env['SCHLUSSEL_JWKS_URL'] ?? 'http://localhost:4000/.well-known/jwks.json'

type TestUser = {
  id: string
  email: string
  name: string
  role: 'user'
  weekStart: null
  dateFormat: null
  timezone: string | null
}

function userForToken(token: string): TestUser | null {
  if (token === 'test-token' || token === 'timezone-test-token') {
    return {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user',
      weekStart: null,
      dateFormat: null,
      timezone: token === 'timezone-test-token' ? 'America/Los_Angeles' : null,
    }
  }
  if (token === 'user2-token') {
    return {
      id: 'user-2',
      email: 'test2@example.com',
      name: 'Test User 2',
      role: 'user',
      weekStart: null,
      dateFormat: null,
      timezone: null,
    }
  }
  return null
}

/**
 * Mock auth middleware for tests.
 * "Bearer test-token"  → user-1
 * "Bearer timezone-test-token" → user-1 with a profile timezone
 * "Bearer user2-token" → user-2
 * anything else        → 401
 */
export const requireAuth = createMiddleware(async (c, next) => {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const token = auth.slice(7)
  const user = userForToken(token)
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  c.set('user', user)
  await next()
})

/**
 * Export routes additionally accept short-lived delegation tokens. The
 * token names stand in for verified JWT claims in this mocked middleware:
 * token_use=export, scope=data:export, and aud=hof-service:tafel.
 */
export const requireExportAuth = createMiddleware(async (c, next) => {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = auth.slice(7)
  const user = userForToken(token)
  const delegatedUser = token === 'tafel-export-user1-token'
    ? userForToken('test-token')
    : token === 'tafel-export-user2-token'
      ? userForToken('user2-token')
      : null
  const principalUser = user ?? delegatedUser
  if (!principalUser) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  c.set('exportPrincipal', delegatedUser
    ? { sub: principalUser.id, kind: 'delegation', jobId: 'test-export-job' }
    : { sub: principalUser.id, kind: 'access' })
  await next()
})
