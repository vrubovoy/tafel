import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, ne, isNull, isNotNull, gte, lte, asc, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { randomUUID } from 'node:crypto'
import { db } from '../../db/index.js'
import { tasks, projects, statuses, notificationOutbox, type Task } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'

const PROJECT_COMPLETED_EVENT_TYPE = 'tafel.project.completed.v1'

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
  if (project.archived) {
    return Response.json({ error: 'Cannot add or move tasks to an archived project' }, { status: 409 })
  }
  return null
}

async function checkStatusOwnership(projectId: string, statusId: string): Promise<Response | null> {
  const status = await db.select().from(statuses)
    .where(and(eq(statuses.id, statusId), eq(statuses.projectId, projectId))).get()
  if (!status) return Response.json({ error: 'Status not found in this project' }, { status: 404 })
  return null
}

// Inserted in the SAME db.transaction() as the task update that completed
// the project (see checkProjectCompletion below) - mirrors kuvert's own
// insertGoalCompletionEvent pattern.
function emitProjectCompletedEvent(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  projectName: string,
): void {
  const id = randomUUID()
  const now = Date.now()
  tx.insert(notificationOutbox).values({
    id,
    eventType: PROJECT_COMPLETED_EVENT_TYPE,
    userId,
    payload: JSON.stringify({ recipientId: userId, projectName }),
    correlationId: id,
    // No durable occurrence ledger needed here unlike the due-date scanner
    // (features/notifications/scanner.ts): that one re-evaluates every
    // candidate on a timer and needs cross-restart dedupe, while this
    // fires at most once per request, directly on the exact transition
    // that completed the project - the dedupe key only has to be unique.
    dedupeKey: id,
    state: 'pending',
    createdAt: now,
    attempts: 0,
    nextAttemptAt: now,
    leaseId: null,
    leaseUntil: null,
    deliveredAt: null,
    permanentAt: null,
    lastError: null,
  }).run()
}

// Fires tafel.project.completed.v1 exactly on the transition from "at
// least one open (non-archived, incomplete) task" to "zero open tasks,
// project non-empty" - computed fresh from sibling task state on every
// call rather than a stored "already notified" flag, so it re-arms on
// its own if new work is added to an already-completed project and later
// finished again (same wasComplete/nowComplete-by-computation shape as
// kuvert's goal completion, see goals/router.ts).
function checkProjectCompletion(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  excludeTaskId: string,
  projectId: string,
  userId: string,
): void {
  const others = tx.select({ completedAt: tasks.completedAt }).from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.archived, false), ne(tasks.id, excludeTaskId)))
    .all()
  if (others.some((task) => task.completedAt === null)) return

  const project = tx.select({ name: projects.name }).from(projects).where(eq(projects.id, projectId)).get()
  if (!project) return
  emitProjectCompletedEvent(tx, userId, project.name)
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

async function hasArchivedAncestor(task: Task): Promise<boolean> {
  if (!task.parentTaskId) return false
  const rows = await db.all<{ archived: number }>(sql`
    WITH RECURSIVE ancestors(id, parent_task_id, archived) AS (
      SELECT id, parent_task_id, archived FROM tasks WHERE id = ${task.parentTaskId}
      UNION ALL
      SELECT t.id, t.parent_task_id, t.archived
      FROM tasks t JOIN ancestors a ON t.id = a.parent_task_id
    )
    SELECT archived FROM ancestors WHERE archived = 1
  `)
  return rows.length > 0
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
    const recurrenceSeriesId = template.recurrenceSeriesId ?? template.id

    // Claim the completed instance by archiving it first. The conditional
    // update is atomic, so concurrent readers cannot both generate its
    // successor, while unrelated recurring tasks may share a title/date.
    db.transaction((tx) => {
      const claimed = tx.update(tasks).set({ archived: true, recurrenceSeriesId })
        .where(and(eq(tasks.id, template.id), eq(tasks.archived, false)))
        .run()
      if (claimed.changes === 0) return

      tx.insert(tasks).values({
        id: createId(),
        userId,
        projectId: template.projectId,
        statusId: defaultStatus.id,
        parentTaskId: template.parentTaskId,
        title: template.title,
        description: template.description,
        priority: template.priority,
        dueDate: nextDueIso,
        sortOrder: 0,
        completedAt: null,
        recurrenceInterval: template.recurrenceInterval,
        recurrenceCount: template.recurrenceCount,
        recurrenceAnchorDate: nextDueIso,
        recurrenceSeriesId,
        archived: false,
        archivedByProject: false,
        createdAt: now,
      }).run()
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
  const id = createId()
  const task = {
    id,
    userId: user.id,
    ...data,
    completedAt: status?.isDone ? now : null,
    recurrenceSeriesId: data.recurrenceInterval ? id : null,
    archived: false,
    archivedByProject: false,
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
  const changingProject = projectId !== existing.projectId
  if (changingProject) {
    const sourceProject = await db.select().from(projects)
      .where(and(eq(projects.id, existing.projectId), eq(projects.userId, user.id))).get()
    if (sourceProject?.archived) {
      return c.json({ error: 'Restore the project before moving its tasks' }, 409)
    }
    const projectError = await checkProjectOwnership(user.id, projectId)
    if (projectError) return projectError
  }

  let statusId = data.statusId ?? existing.statusId
  if (changingProject && !data.statusId) {
    const defaultStatus = await db.select().from(statuses)
      .where(and(eq(statuses.projectId, projectId), eq(statuses.isDone, false)))
      .orderBy(asc(statuses.sortOrder))
      .get()
      ?? await db.select().from(statuses)
        .where(eq(statuses.projectId, projectId))
        .orderBy(asc(statuses.sortOrder))
        .get()
    if (!defaultStatus) return c.json({ error: 'Target project has no statuses' }, 422)
    statusId = defaultStatus.id
  }
  if (data.statusId || changingProject) {
    const statusError = await checkStatusOwnership(projectId, statusId)
    if (statusError) return statusError
  }

  const parentTaskId = changingProject ? (data.parentTaskId ?? null) : data.parentTaskId
  if (parentTaskId !== undefined) {
    const parentError = await checkParentTaskOwnership(user.id, projectId, parentTaskId, id)
    if (parentError) return parentError
  }

  let completedAt = existing.completedAt
  let becameDone = false
  if (statusId !== existing.statusId) {
    const oldStatus = await db.select().from(statuses).where(eq(statuses.id, existing.statusId)).get()
    const newStatus = await db.select().from(statuses).where(eq(statuses.id, statusId)).get()
    if (newStatus?.isDone && !oldStatus?.isDone) { completedAt = new Date(); becameDone = true }
    else if (!newStatus?.isDone) completedAt = null
  }

  const update = {
    ...data,
    ...(changingProject ? { projectId, statusId, parentTaskId } : {}),
    completedAt,
    ...(data.recurrenceInterval !== undefined
      ? {
          recurrenceSeriesId: data.recurrenceInterval
            ? existing.recurrenceSeriesId ?? createId()
            : null,
        }
      : {}),
  }

  if (changingProject) {
    const descendantIds = await collectDescendantIds(id)
    const defaultStatus = await db.select().from(statuses)
      .where(and(eq(statuses.projectId, projectId), eq(statuses.isDone, false)))
      .orderBy(asc(statuses.sortOrder))
      .get()
      ?? await db.select().from(statuses).where(eq(statuses.projectId, projectId)).orderBy(asc(statuses.sortOrder)).get()

    db.transaction((tx) => {
      tx.update(tasks).set(update).where(eq(tasks.id, id)).run()
      if (defaultStatus) {
        for (const descendantId of descendantIds) {
          tx.update(tasks).set({
            projectId,
            statusId: defaultStatus.id,
            completedAt: defaultStatus.isDone ? new Date() : null,
          }).where(eq(tasks.id, descendantId)).run()
        }
      }
      if (becameDone) checkProjectCompletion(tx, id, projectId, user.id)
    })
  } else {
    db.transaction((tx) => {
      tx.update(tasks).set(update).where(eq(tasks.id, id)).run()
      if (becameDone) checkProjectCompletion(tx, id, projectId, user.id)
    })
  }

  return c.json({ ...existing, ...update })
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
      tx.update(tasks).set({ archived: true, archivedByProject: false }).where(eq(tasks.id, taskId)).run()
    }
  })

  return c.json({ ok: true })
})

router.post('/:id/restore', async (c) => {
  const user = c.get('user')
  const { id } = c.req.param()
  const existing = await db.select().from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, user.id)))
    .get()
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const project = await db.select().from(projects)
    .where(and(eq(projects.id, existing.projectId), eq(projects.userId, user.id), eq(projects.archived, false)))
    .get()
  if (!project) return c.json({ error: 'Restore the project before restoring its tasks' }, 409)

  if (await hasArchivedAncestor(existing)) {
    return c.json({ error: 'Restore ancestor tasks first' }, 409)
  }

  const candidateIds = [id, ...(await collectDescendantIds(id))]
  const userTasks = await db.select().from(tasks).where(eq(tasks.userId, user.id))
  const idsToRestore = candidateIds.filter((candidateId) => {
    const candidate = userTasks.find((task) => task.id === candidateId)
    if (!candidate) return false
    if (!candidate.completedAt || !candidate.recurrenceInterval || !candidate.recurrenceSeriesId) return true
    const nextAnchor = toISODate(computeNextOccurrence(candidate))
    return !userTasks.some((peer) => (
      peer.id !== candidate.id
      && peer.recurrenceSeriesId === candidate.recurrenceSeriesId
      && peer.recurrenceAnchorDate !== null
      && peer.recurrenceAnchorDate >= nextAnchor
    ))
  })
  if (!idsToRestore.includes(id)) {
    return c.json({ error: 'A later recurring occurrence already exists' }, 409)
  }

  db.transaction((tx) => {
    for (const taskId of idsToRestore) {
      tx.update(tasks).set({ archived: false, archivedByProject: false }).where(eq(tasks.id, taskId)).run()
    }
  })

  return c.json({ ...existing, archived: false })
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
  let becameDone = false
  if (statusId !== existing.statusId) {
    const oldStatus = await db.select().from(statuses).where(eq(statuses.id, existing.statusId)).get()
    const newStatus = await db.select().from(statuses).where(eq(statuses.id, statusId)).get()
    if (newStatus?.isDone && !oldStatus?.isDone) { completedAt = new Date(); becameDone = true }
    else if (!newStatus?.isDone) completedAt = null
  }

  const parentCondition = existing.parentTaskId === null
    ? isNull(tasks.parentTaskId)
    : eq(tasks.parentTaskId, existing.parentTaskId)
  const siblings = await db.select().from(tasks).where(and(
    eq(tasks.userId, user.id),
    eq(tasks.projectId, existing.projectId),
    eq(tasks.archived, false),
    parentCondition,
  )).orderBy(asc(tasks.sortOrder), asc(tasks.createdAt))

  const sourceTasks = siblings.filter((task) => task.statusId === existing.statusId && task.id !== id)
  const targetTasks = (statusId === existing.statusId
    ? sourceTasks
    : siblings.filter((task) => task.statusId === statusId && task.id !== id))
  const targetIndex = Math.max(0, Math.min(sortOrder, targetTasks.length))
  const persistedSortOrder = sortOrder > targetTasks.length ? sortOrder : targetIndex
  const reorderedTarget = [...targetTasks]
  reorderedTarget.splice(targetIndex, 0, { ...existing, statusId, completedAt })

  db.transaction((tx) => {
    if (statusId !== existing.statusId) {
      sourceTasks.forEach((task, index) => {
        tx.update(tasks).set({ sortOrder: index }).where(eq(tasks.id, task.id)).run()
      })
    }
    reorderedTarget.forEach((task, index) => {
      tx.update(tasks).set({
        sortOrder: task.id === id ? persistedSortOrder : index,
        ...(task.id === id ? { statusId, completedAt } : {}),
      }).where(eq(tasks.id, task.id)).run()
      if (task.id === id && becameDone) checkProjectCompletion(tx, id, existing.projectId, user.id)
    })
  })

  return c.json({ ...existing, statusId, sortOrder: persistedSortOrder, completedAt })
})

export { router as tasksRouter }
