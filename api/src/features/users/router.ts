import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { users } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

// requireAuth auto-provisions the local user row on every authenticated
// request, so by the time this handler runs the row is guaranteed to
// exist - no "not found" branch needed.
router.get('/me', async (c) => {
  const user = c.get('user')
  const row = await db.select().from(users).where(eq(users.id, user.id)).get()
  return c.json({ id: row!.id, email: row!.email, name: row!.name })
})

export { router as usersRouter }
