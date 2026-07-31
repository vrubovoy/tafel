import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, ne } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.js'
import { statuses, projects, tasks } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

// A project's custom kanban columns. Scoped via projectId -> projects.userId
// (this table has no userId of its own) - kept as a flat top-level router
// with projectId passed via query/body, matching this codebase's existing
// cross-reference convention (e.g. kuvert's envelopes/categories) rather
// than relying on framework-level nested route-param mounting.
export const statusSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).default('#94a3b8'),
  sortOrder: z.number().int().default(0),
  isDone: z.boolean().default(false),
})

// Deliberately not statusSchema.partial() - see projects/router.ts's
// projectUpdateSchema comment for why .default() and .partial() don't
// mix safely. No projectId field at all: a status can't move projects.
const statusUpdateSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  sortOrder: z.number().int().optional(),
  isDone: z.boolean().optional(),
})

async function checkProjectOwnership(userId: string, projectId: string): Promise<Response | null> {
  const project = await db.select().from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId))).get()
  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 })
  return null
}

router.get('/', async (c) => {
  const user = c.get('user')
  const projectId = c.req.query('projectId')
  if (!projectId) return c.json({ error: 'projectId is required' }, 400)

  const ownershipError = await checkProjectOwnership(user.id, projectId)
  if (ownershipError) return ownershipError

  return c.json(await db.select().from(statuses).where(eq(statuses.projectId, projectId)))
})

router.post('/', zValidator('json', statusSchema), async (c) => {
  const user = c.get('user')
  const data = c.req.valid('json')

  const ownershipError = await checkProjectOwnership(user.id, data.projectId)
  if (ownershipError) return ownershipError

  const status = { id: createId(), ...data, createdAt: new Date() }
  await db.insert(statuses).values(status)
  return c.json(status, 201)
})

router.put('/:id', zValidator('json', statusUpdateSchema), async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const data = c.req.valid('json')

  const existing = await db.select().from(statuses).where(eq(statuses.id, id)).get()
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const ownershipError = await checkProjectOwnership(user.id, existing.projectId)
  if (ownershipError) return ownershipError

  await db.update(statuses).set(data).where(eq(statuses.id, id))
  return c.json({ ...existing, ...data })
})

// Deleting a status that still has tasks requires an explicit reassignTo
// (another status in the same project) to move them first - refusing
// with 409 otherwise means a status can never be deleted out from under
// tasks that still reference it, silently orphaning them.
router.delete('/:id', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const reassignTo = c.req.query('reassignTo')

  const existing = await db.select().from(statuses).where(eq(statuses.id, id)).get()
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const ownershipError = await checkProjectOwnership(user.id, existing.projectId)
  if (ownershipError) return ownershipError

  const tasksUsingStatus = await db.select().from(tasks)
    .where(and(eq(tasks.statusId, id), eq(tasks.archived, false)))

  if (tasksUsingStatus.length > 0) {
    if (!reassignTo) {
      return c.json({ error: 'Status still has tasks; pass reassignTo to move them first' }, 409)
    }
    const target = await db.select().from(statuses)
      .where(and(eq(statuses.id, reassignTo), eq(statuses.projectId, existing.projectId), ne(statuses.id, id)))
      .get()
    if (!target) return c.json({ error: 'reassignTo status not found in this project' }, 404)

    await db.update(tasks).set({ statusId: reassignTo }).where(eq(tasks.statusId, id))
  }

  await db.delete(statuses).where(eq(statuses.id, id))
  return c.json({ ok: true })
})

export { router as statusesRouter }
