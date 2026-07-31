import { Hono } from 'hono'
import { eq, and, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { tasks } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'
import { regenerateDueRecurringTasks } from '../tasks/router.js'

const router = new Hono()
router.use('*', requireAuth)

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

router.get('/summary', async (c) => {
  const user = c.get('user')
  // Regenerated here too, not just on GET /tasks - a dashboard visit
  // shouldn't show stale counts before a list-page visit happens to run
  // the same check.
  await regenerateDueRecurringTasks(user.id)

  const today = toISODate(new Date())

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
  const dayBuckets: string[] = []
  const start = new Date()
  start.setDate(start.getDate() - 13)
  for (let i = 0; i < 14; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    dayBuckets.push(toISODate(d))
  }
  // completedAt is stored as epoch *milliseconds* (schema.ts uses
  // `mode: 'timestamp_ms'`) - SQLite's 'unixepoch' modifier expects
  // seconds, hence the /1000.
  const completionRows = await db.all<{ day: string; count: number }>(sql`
    SELECT date(t.completed_at / 1000, 'unixepoch') AS day, COUNT(*) AS count
    FROM tasks t
    WHERE t.user_id = ${user.id} AND t.completed_at IS NOT NULL
      AND date(t.completed_at / 1000, 'unixepoch') >= ${dayBuckets[0]}
    GROUP BY day
  `)
  const completionByDay = new Map(completionRows.map((r) => [r.day, r.count]))
  const completedLast14Days = dayBuckets.map((day) => completionByDay.get(day) ?? 0)

  // Current streak: consecutive days ending today with >=1 completion.
  let currentStreak = 0
  for (let i = completedLast14Days.length - 1; i >= 0; i--) {
    if (completedLast14Days[i] === 0) break
    currentStreak++
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
