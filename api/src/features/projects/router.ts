import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.js'
import { projects, statuses, tasks } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

export const projectSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default('#f59e0b'),
  icon: z.string().max(50).default('folder'),
  sortOrder: z.number().int().default(0),
})

// Deliberately NOT projectSchema.partial(): Zod's .default() fires
// whenever a key is *absent* from the input, regardless of .optional()/
// .partial() - so a partial PUT omitting e.g. `color` would silently
// reset it to '#f59e0b' instead of leaving it untouched. This schema's
// fields have no defaults at all, so an absent key stays absent in the
// validated output and never overwrites the existing column.
const projectUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  icon: z.string().max(50).optional(),
  sortOrder: z.number().int().optional(),
})

router.get('/', async (c) => {
  const user = c.get('user')
  return c.json(
    await db.select().from(projects)
      .where(and(eq(projects.userId, user.id), eq(projects.archived, false))),
  )
})

// A project always gets 3 default statuses on creation (To Do/In
// Progress/Done, isDone only on the last) - seeded in the same
// transaction as the project itself so a project never briefly exists
// with zero kanban columns. The user can rename/recolor/reorder/add/
// remove from there via the statuses sub-router.
router.post('/', zValidator('json', projectSchema), async (c) => {
  const user = c.get('user')
  const data = c.req.valid('json')
  const now = new Date()
  const project = { id: createId(), userId: user.id, ...data, archived: false, createdAt: now }

  const defaultStatuses = [
    { id: createId(), projectId: project.id, name: 'К выполнению', color: '#94a3b8', sortOrder: 0, isDone: false, createdAt: now },
    { id: createId(), projectId: project.id, name: 'В процессе', color: '#3b82f6', sortOrder: 1, isDone: false, createdAt: now },
    { id: createId(), projectId: project.id, name: 'Готово', color: '#22c55e', sortOrder: 2, isDone: true, createdAt: now },
  ]

  db.transaction((tx) => {
    tx.insert(projects).values(project).run()
    tx.insert(statuses).values(defaultStatuses).run()
  })

  return c.json(project, 201)
})

router.put('/:id', zValidator('json', projectUpdateSchema), async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const data = c.req.valid('json')
  const existing = await db.select().from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, user.id))).get()
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await db.update(projects).set(data).where(eq(projects.id, id))
  return c.json({ ...existing, ...data })
})

// Archiving a project archives its tasks too (explicit in the handler,
// not a DB trigger, so it stays visible/testable) - restoring only
// un-archives the project itself, an explicit per-task restore avoids
// silently un-completing everything.
router.delete('/:id', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const existing = await db.select().from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, user.id))).get()
  if (!existing) return c.json({ error: 'Not found' }, 404)

  db.transaction((tx) => {
    tx.update(projects).set({ archived: true }).where(eq(projects.id, id)).run()
    tx.update(tasks).set({ archived: true }).where(eq(tasks.projectId, id)).run()
  })

  return c.json({ ok: true })
})

router.post('/:id/restore', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const existing = await db.select().from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, user.id))).get()
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await db.update(projects).set({ archived: false }).where(eq(projects.id, id))
  return c.json({ ...existing, archived: false })
})

export { router as projectsRouter }
