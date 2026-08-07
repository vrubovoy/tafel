import { Hono } from 'hono'
import { eq, and, isNotNull, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { tasks } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'
import { regenerateDueRecurringTasks } from '../tasks/router.js'

const router = new Hono()
router.use('*', requireAuth)

function dateKey(date: Date, timezone: string | null): string {
  if (!timezone) return date.toISOString().slice(0, 10)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

function addDays(day: string, amount: number): string {
  const [year, month, date] = day.split('-').map(Number)
  const shifted = new Date(Date.UTC(year!, month! - 1, date! + amount))
  return shifted.toISOString().slice(0, 10)
}

router.get('/summary', async (c) => {
  const user = c.get('user')
  // Regenerated here too, not just on GET /tasks - a dashboard visit
  // shouldn't show stale counts before a list-page visit happens to run
  // the same check.
  await regenerateDueRecurringTasks(user.id)

  const today = dateKey(new Date(), user.timezone)

  // COALESCE is required here, not just a JS-side `?? 0` on the result -
  // SQLite's SUM() over zero matching rows (a user with no tasks at all)
  // returns NULL, not 0, and NULL survives a plain destructuring default
  // (which only triggers on `undefined`) straight into the JSON response.
  const totals = await db.all<{ total: number; completed: number; overdue: number }>(sql`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN s.is_done = 1 THEN 1 ELSE 0 END), 0) AS completed,
      COALESCE(SUM(CASE WHEN s.is_done = 0 AND t.due_date IS NOT NULL AND t.due_date < ${today} THEN 1 ELSE 0 END), 0) AS overdue
    FROM tasks t
    JOIN statuses s ON s.id = t.status_id
    WHERE t.user_id = ${user.id} AND t.archived = 0
  `)
  const { total = 0, completed = 0, overdue = 0 } = totals[0] ?? {}

  const tasksByProject = await db.all<{
    projectId: string; name: string; color: string; total: number; completed: number
  }>(sql`
    SELECT
      p.id AS projectId, p.name AS name, p.color AS color,
      COUNT(t.id) AS total,
      COALESCE(SUM(CASE WHEN s.is_done = 1 THEN 1 ELSE 0 END), 0) AS completed
    FROM projects p
    LEFT JOIN tasks t ON t.project_id = p.id AND t.archived = 0
    LEFT JOIN statuses s ON s.id = t.status_id
    WHERE p.user_id = ${user.id} AND p.archived = 0
    GROUP BY p.id
    ORDER BY p.sort_order
  `)

  // 14-day completion trend, oldest to newest, today inclusive.
  const dayBuckets = Array.from({ length: 14 }, (_, index) => addDays(today, index - 13))
  const completionRows = await db.select({ completedAt: tasks.completedAt }).from(tasks).where(and(
    eq(tasks.userId, user.id),
    isNotNull(tasks.completedAt),
  ))
  const completionByDay = new Map<string, number>()
  for (const row of completionRows) {
    const day = dateKey(row.completedAt!, user.timezone)
    completionByDay.set(day, (completionByDay.get(day) ?? 0) + 1)
  }
  const completedLast14Days = dayBuckets.map((day) => completionByDay.get(day) ?? 0)

  // Current streak uses complete history; the 14-day series is only the
  // chart window and must not cap a longer run.
  let currentStreak = 0
  let expectedDay = today
  while (completionByDay.has(expectedDay)) {
    currentStreak++
    expectedDay = addDays(expectedDay, -1)
  }

  const activeRecurringRows = await db.select().from(tasks).where(and(
    eq(tasks.userId, user.id),
    eq(tasks.archived, false),
  ))
  const activeRecurringTasks = activeRecurringRows.filter((t) => t.recurrenceInterval !== null).length

  return c.json({
    totalTasks: total,
    completedTasks: completed,
    completionRate: total > 0 ? completed / total : 0,
    overdueTasks: overdue,
    tasksByProject,
    completedLast14Days,
    currentStreak,
    activeRecurringTasks,
  })
})

export { router as statsRouter }
