import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { users } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

// 0 = Sunday, 1 = Monday - matches JS Date#getDay()'s own numbering.
const updateSchema = z.object({
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
})

// requireAuth auto-provisions the local user row on every authenticated
// request, so by the time these handlers run the row is guaranteed to
// exist - no "not found" branch needed.
router.get('/me', async (c) => {
  const user = c.get('user')
  const row = await db.select().from(users).where(eq(users.id, user.id)).get()
  return c.json({ id: row!.id, email: row!.email, name: row!.name, weekStartsOn: row!.weekStartsOn })
})

router.put('/me', zValidator('json', updateSchema), async (c) => {
  const user = c.get('user')
  const { weekStartsOn } = c.req.valid('json')
  await db.update(users).set({ weekStartsOn }).where(eq(users.id, user.id))
  const row = await db.select().from(users).where(eq(users.id, user.id)).get()
  return c.json({ id: row!.id, email: row!.email, name: row!.name, weekStartsOn: row!.weekStartsOn })
})

export { router as usersRouter }
