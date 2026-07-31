import { createMiddleware } from 'hono/factory'

/**
 * Mock auth middleware for tests.
 * "Bearer test-token"  → user-1
 * "Bearer user2-token" → user-2
 * anything else        → 401
 */
export const requireAuth = createMiddleware(async (c, next) => {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const token = auth.slice(7)
  if (token === 'test-token') {
    c.set('user', {
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      role: 'user' as const,
    })
  } else if (token === 'user2-token') {
    c.set('user', {
      id: 'user-2',
      email: 'test2@example.com',
      name: 'Test User 2',
      role: 'user' as const,
    })
  } else {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})
