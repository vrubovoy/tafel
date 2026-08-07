import { randomUUID } from 'node:crypto'
import { and, eq, isNull, isNotNull } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { tasks, statuses, projects, users, notificationOutbox } from '../../db/schema.js'

const EVENT_TYPE = 'tafel.task.due.v1'

function todayInTimezone(now: Date, timezone: string): string {
  // en-CA formats as YYYY-MM-DD, matching dueDate's own ISO storage
  // format exactly - lets the two be compared as plain strings.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export interface ScanTaskDueNotificationsOptions {
  now?: () => Date
  createId?: () => string
}

// Runs on a timer (see notifications/outbox.ts's caller in index.ts), not
// tied to any request - "today" is computed per task owner's own
// timezone (falling back to UTC if never set - see schema.ts's users.timezone
// comment), not the scanning process's local time. One event per
// (task, due date, occurrence) via the notification_outbox table's own
// dedupe_key unique index (Tafel's own dedupe policy - see schema.ts):
// a re-scan of an already-notified task silently no-ops rather than
// duplicating, while a changed due date naturally produces a fresh key
// and a fresh notification.
export async function scanTaskDueNotifications(options: ScanTaskDueNotificationsOptions = {}): Promise<number> {
  const now = options.now ?? (() => new Date())
  const createId = options.createId ?? randomUUID

  const rows = await db.select({
    taskId: tasks.id,
    userId: tasks.userId,
    title: tasks.title,
    dueDate: tasks.dueDate,
    timezone: users.timezone,
  })
    .from(tasks)
    .innerJoin(statuses, eq(statuses.id, tasks.statusId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(users, eq(users.id, tasks.userId))
    .where(and(
      isNull(tasks.completedAt),
      eq(statuses.isDone, false),
      eq(tasks.archived, false),
      eq(projects.archived, false),
      isNotNull(tasks.dueDate),
    ))

  const nowDate = now()
  const nowMs = nowDate.getTime()
  let emitted = 0

  for (const row of rows) {
    const dueDate = row.dueDate
    if (!dueDate) continue // isNotNull above already guarantees this, narrows the type

    const today = todayInTimezone(nowDate, row.timezone ?? 'UTC')
    let occurrence: 'due-today' | 'overdue'
    if (dueDate === today) occurrence = 'due-today'
    else if (dueDate < today) occurrence = 'overdue'
    else continue // due in the future - not yet due

    const id = createId()
    const result = await db.insert(notificationOutbox).values({
      id,
      eventType: EVENT_TYPE,
      userId: row.userId,
      payload: JSON.stringify({
        recipientId: row.userId,
        taskTitle: row.title,
        dueDate,
        overdue: occurrence === 'overdue',
      }),
      correlationId: id,
      dedupeKey: `${row.taskId}:${dueDate}:${occurrence}`,
      state: 'pending',
      createdAt: nowMs,
      attempts: 0,
      nextAttemptAt: nowMs,
      leaseId: null,
      leaseUntil: null,
      deliveredAt: null,
      lastError: null,
    }).onConflictDoNothing({ target: notificationOutbox.dedupeKey })

    if (result.changes > 0) emitted += 1
  }

  return emitted
}
