import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, isNull, isNotNull, gte, lte, asc, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.js'
import { tasks, projects, statuses, type Task } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

export const taskSchema = z.object({
  projectId: z.string(),
  parentTaskId: z.string().nullable().default(null),
  statusId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().default(null),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  sortOrder: z.number().int().default(0),
  recurrenceInterval: z.enum(['daily', 'weekly', 'monthly']).nullable().default(null),
  recurrenceCount: z.number().int().positive().nullable().default(null),
})

// Deliberately NOT taskSchema.partial(): Zod's .default() fires whenever
// a key is *absent* from the input, regardless of .optional()/.partial()
// - a partial PUT that only means to change e.g. `title` would otherwise
// silently reset parentTaskId to null (detaching the task from its
// parent!), priority to 'medium', dueDate to null, sortOrder to 0, and
// both recurrence fields to null, on every single update. This schema's
// fields have no defaults at all, so an absent key stays absent in the
// validated output and never overwrites the existing column.
const taskUpdateSchema = z.object({
  projectId: z.string().optional(),
  parentTaskId: z.string().nullable().optional(),
  statusId: z.string().optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  sortOrder: z.number().int().optional(),
  recurrenceInterval: z.enum(['daily', 'weekly', 'monthly']).nullable().optional(),
  recurrenceCount: z.number().int().positive().nullable().optional(),
})

const listQuerySchema = z.object({
  projectId: z.string().optional(),
  // '' explicitly requests top-level tasks only (parentTaskId IS NULL,
  // the default Kanban view); omitted returns tasks at every depth
  // (List/Calendar views); a real id requests that task's direct
  // children (Kanban drill-in).
  parentTaskId: z.string().optional(),
  statusId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

const reorderSchema = z.object({
  statusId: z.string(),
  sortOrder: z.number().int(),
})

// ── Ownership / cross-reference guards ─────────────────────────────

async function checkProjectOwnership(userId: string, projectId: string): Promise<Response | null> {
  const project = await db.select().from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId))).get()
  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 })
  return null
}

async function checkStatusOwnership(projectId: string, statusId: string): Promise<Response | null> {
  const status = await db.select().from(statuses)
    .where(and(eq(statuses.id, statusId), eq(statuses.projectId, projectId))).get()
  if (!status) return Response.json({ error: 'Status not found in this project' }, { status: 404 })
  return null
}

// Walks up from `newParentId`'s own ancestor chain via a recursive CTE -
// if `taskId` appears anywhere in it (or equals newParentId itself),
// newParentId is a descendant of taskId, and accepting this reparent
// would create a cycle.
async function wouldCreateCycle(taskId: string, newParentId: string): Promise<boolean> {
  if (taskId === newParentId) return true
  const rows = await db.all<{ id: string }>(sql`
    WITH RECURSIVE ancestors(id, parent_task_id) AS (
      SELECT id, parent_task_id FROM tasks WHERE id = ${newParentId}
      UNION ALL
      SELECT t.id, t.parent_task_id FROM tasks t
      JOIN ancestors a ON t.id = a.parent_task_id
    )
    SELECT id FROM ancestors WHERE id = ${taskId}
  `)
  return rows.length > 0
}

async function checkParentTaskOwnership(
  userId: string,
  projectId: string,
  parentTaskId: string | null,
  taskId?: string,
): Promise<Response | null> {
  if (!parentTaskId) return null
  const parent = await db.select().from(tasks)
    .where(and(eq(tasks.id, parentTaskId), eq(tasks.userId, userId))).get()
  if (!parent) return Response.json({ error: 'Parent task not found' }, { status: 404 })
  if (parent.projectId !== projectId) {
    return Response.json({ error: 'Parent task belongs to a different project' }, { status: 422 })
  }
  if (taskId && (await wouldCreateCycle(taskId, parentTaskId))) {
    return Response.json({ error: 'Cannot make a task a subtask of its own descendant' }, { status: 422 })
  }
  return null
}

// Collects every descendant id (any depth) via a recursive CTE, for
// cascade-archiving a task's whole subtree in one go.
async function collectDescendantIds(taskId: string): Promise<string[]> {
  const rows = await db.all<{ id: string }>(sql`
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM tasks WHERE parent_task_id = ${taskId}
      UNION ALL
      SELECT t.id FROM tasks t JOIN descendants d ON t.parent_task_id = d.id
    )
    SELECT id FROM descendants
  `)
  return rows.map((r) => r.id)
}

// ── Recurring tasks - lazy, no cron ─────────────────────────────────
// Regenerated the next time the task list (or stats) is read, once the
// template itself is marked done - never a scheduled job, matching
// kuvert's goals precedent for a self-hosted app with no scheduler
// process. "Done" is status.isDone, not a literal status id/name.

function computeNextOccurrence(template: Task): Date {
  const anchorSource = template.recurrenceAnchorDate ?? template.dueDate
  const anchor = anchorSource ? new Date(anchorSource) : template.createdAt
  const count = template.recurrenceCount ?? 1
  const next = new Date(anchor)
  switch (template.recurrenceInterval) {
    case 'daily': next.setDate(next.getDate() + count); break
    case 'weekly': next.setDate(next.getDate() + count * 7); break
    case 'monthly': next.setMonth(next.getMonth() + count); break
  }
  return next
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function regenerateDueRecurringTasks(userId: string): Promise<void> {
  const templates = await db.select().from(tasks).where(and(
    eq(tasks.userId, userId),
    eq(tasks.archived, false),
    isNotNull(tasks.recurrenceInterval),
  ))

  const now = new Date()

  for (const template of templates) {
    const status = await db.select().from(statuses).where(eq(statuses.id, template.statusId)).get()
    if (!status?.isDone) continue

    const nextDue = computeNextOccurrence(template)
    if (nextDue > now) continue

    const nextDueIso = toISODate(nextDue)

    // Resolved before the transaction (async) - the regenerated
    // instance's initial column is the project's own lowest-sortOrder
    // non-done status.
    const defaultStatus = await db.select().from(statuses)
      .where(and(eq(statuses.projectId, template.projectId), eq(statuses.isDone, false)))
      .orderBy(asc(statuses.sortOrder))
      .get()
    if (!defaultStatus) continue

    // better-sqlite3 executes synchronously and Node is single-threaded,
    // so no other request handler can interleave between this duplicate
    // check and the insert within the same transaction - two near-
    // simultaneous GET /tasks calls (e.g. two open tabs) can't both
    // insert a successor for the same occurrence.
    db.transaction((tx) => {
      const dup = tx.select().from(tasks).where(and(
        eq(tasks.userId, userId),
        eq(tasks.title, template.title),
        eq(tasks.recurrenceAnchorDate, nextDueIso),
        eq(tasks.archived, false),
      )).get()
      if (dup) return

      tx.insert(tasks).values({
        id: createId(),
        userId,
        projectId: template.projectId,
        statusId: defaultStatus.id,
        parentTaskId: null,
        title: template.title,
        description: template.description,
        priority: template.priority,
        dueDate: nextDueIso,
        sortOrder: 0,
        completedAt: null,
        recurrenceInterval: null,
        recurrenceCount: null,
        recurrenceAnchorDate: nextDueIso,
        archived: false,
        createdAt: now,
      }).run()

      // Archive the completed template itself so it doesn't keep
      // matching future regeneration passes.
      tx.update(tasks).set({ archived: true }).where(eq(tasks.id, template.id)).run()
    })
  }
}

// ── Routes ────────────────────────────────────────────────────────

router.get('/', zValidator('query', listQuerySchema), async (c) => {
  const user = c.get('user')
  await regenerateDueRecurringTasks(user.id)

  const { projectId, parentTaskId, statusId, from, to } = c.req.valid('query')

  const conditions = [eq(tasks.userId, user.id), eq(tasks.archived, false)]
  if (projectId) conditions.push(eq(tasks.projectId, projectId))
  if (statusId) conditions.push(eq(tasks.statusId, statusId))
  if (parentTaskId !== undefined) {
    conditions.push(parentTaskId === '' ? isNull(tasks.parentTaskId) : eq(tasks.parentTaskId, parentTaskId))
  }
  if (from) conditions.push(gte(tasks.dueDate, from))
  if (to) conditions.push(lte(tasks.dueDate, to))

  return c.json(await db.select().from(tasks).where(and(...conditions)))
})

router.post('/', zValidator('json', taskSchema), async (c) => {
  const user = c.get('user')
  const data = c.req.valid('json')

  const projectError = await checkProjectOwnership(user.id, data.projectId)
  if (projectError) return projectError
  const statusError = await checkStatusOwnership(data.projectId, data.statusId)
  if (statusError) return statusError
  const parentError = await checkParentTaskOwnership(user.id, data.projectId, data.parentTaskId)
  if (parentError) return parentError

  const status = await db.select().from(statuses).where(eq(statuses.id, data.statusId)).get()
  const now = new Date()
  const task = {
    id: createId(),
    userId: user.id,
    ...data,
    completedAt: status?.isDone ? now : null,
    archived: false,
    createdAt: now,
  }
  await db.insert(tasks).values(task)
  return c.json(task, 201)
})

router.put('/:id', zValidator('json', taskUpdateSchema), async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const data = c.req.valid('json')

  const existing = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, user.id))).get()
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const projectId = data.projectId ?? existing.projectId
  if (data.projectId) {
    const projectError = await checkProjectOwnership(user.id, data.projectId)
    if (projectError) return projectError
  }
  if (data.statusId) {
    const statusError = await checkStatusOwnership(projectId, data.statusId)
    if (statusError) return statusError
  }
  if (data.parentTaskId !== undefined) {
    const parentError = await checkParentTaskOwnership(user.id, projectId, data.parentTaskId, id)
    if (parentError) return parentError
  }

  let completedAt = existing.completedAt
  if (data.statusId && data.statusId !== existing.statusId) {
    const oldStatus = await db.select().from(statuses).where(eq(statuses.id, existing.statusId)).get()
    const newStatus = await db.select().from(statuses).where(eq(statuses.id, data.statusId)).get()
    if (newStatus?.isDone && !oldStatus?.isDone) completedAt = new Date()
    else if (!newStatus?.isDone) completedAt = null
  }

  await db.update(tasks).set({ ...data, completedAt }).where(eq(tasks.id, id))
  return c.json({ ...existing, ...data, completedAt })
})

// Cascade-archives the task's whole subtree (any depth) in one
// transaction - hard delete already cascades natively via the schema's
// onDelete: 'cascade', but archiving is a value update, not a row
// deletion, so it needs this explicit recursive step.
router.delete('/:id', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const existing = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, user.id))).get()
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const idsToArchive = [id, ...(await collectDescendantIds(id))]

  db.transaction((tx) => {
    for (const taskId of idsToArchive) {
      tx.update(tasks).set({ archived: true }).where(eq(tasks.id, taskId)).run()
    }
  })

  return c.json({ ok: true })
})

// Dedicated, lightweight endpoint for kanban drag-and-drop - avoids
// re-validating the full task schema on every drag.
router.put('/:id/reorder', zValidator('json', reorderSchema), async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const { statusId, sortOrder } = c.req.valid('json')

  const existing = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, user.id))).get()
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const statusError = await checkStatusOwnership(existing.projectId, statusId)
  if (statusError) return statusError

  let completedAt = existing.completedAt
  if (statusId !== existing.statusId) {
    const oldStatus = await db.select().from(statuses).where(eq(statuses.id, existing.statusId)).get()
    const newStatus = await db.select().from(statuses).where(eq(statuses.id, statusId)).get()
    if (newStatus?.isDone && !oldStatus?.isDone) completedAt = new Date()
    else if (!newStatus?.isDone) completedAt = null
  }

  await db.update(tasks).set({ statusId, sortOrder, completedAt }).where(eq(tasks.id, id))
  return c.json({ ...existing, statusId, sortOrder, completedAt })
})

export { router as tasksRouter }
