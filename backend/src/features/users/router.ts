import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { users, projects, statuses, tasks } from '../../db/schema.js'
import { requireAuth } from '../../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

// 0 = Sunday, 1 = Monday - matches JS Date#getDay()'s own numbering.
// `null` explicitly clears a Tafel-specific override, falling back to
// the platform-wide preference (see resolveWeekStartsOn below).
const updateSchema = z.object({
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).nullable(),
})

// The platform-wide weekStart schlussel embeds in the JWT ('monday' |
// 'sunday' | null) uses different values than Tafel's own historical
// 0/1 column - translate once here rather than at every call site.
function platformWeekStartsOn(user: { weekStart: 'monday' | 'sunday' | null }): 0 | 1 | null {
  if (user.weekStart === 'sunday') return 0
  if (user.weekStart === 'monday') return 1
  return null
}

// A Tafel-specific override (the local `weekStartsOn` column) wins if
// the user ever explicitly set one; otherwise falls back to their
// platform-wide preference from schlussel; otherwise Monday, Tafel's
// own longstanding default before either preference existed.
function resolveWeekStartsOn(row: { weekStartsOn: number | null }, user: { weekStart: 'monday' | 'sunday' | null }): 0 | 1 {
  if (row.weekStartsOn === 0 || row.weekStartsOn === 1) return row.weekStartsOn
  return platformWeekStartsOn(user) ?? 1
}

// requireAuth auto-provisions the local user row on every authenticated
// request, so by the time these handlers run the row is guaranteed to
// exist - no "not found" branch needed.
router.get('/me', async (c) => {
  const user = c.get('user')
  const row = await db.select().from(users).where(eq(users.id, user.id)).get()
  return c.json({
    id: row!.id, email: row!.email, name: row!.name,
    weekStartsOn: resolveWeekStartsOn(row!, user),
    weekStartsOnOverride: row!.weekStartsOn,
    // Straight passthrough - Tafel has no local override concept for
    // these two (unlike weekStartsOn), so the platform-wide value from
    // Schlüssel (via the JWT) is always the one in effect.
    dateFormat: user.dateFormat,
    timezone: user.timezone,
  })
})

router.get('/export', async (c) => {
  const user = c.get('user')
  const ownedProjects = await db.select().from(projects).where(eq(projects.userId, user.id))
  const projectIds = ownedProjects.map((project) => project.id)
  const ownedStatuses = projectIds.length > 0
    ? await db.select().from(statuses).where(inArray(statuses.projectId, projectIds))
    : []
  const ownedTasks = await db.select().from(tasks).where(eq(tasks.userId, user.id))

  return c.json({
    scope: 'tafel-account-only',
    exportedAt: new Date().toISOString(),
    projects: ownedProjects,
    statuses: ownedStatuses,
    tasks: ownedTasks,
  })
})

router.put('/me', zValidator('json', updateSchema), async (c) => {
  const user = c.get('user')
  const { weekStartsOn } = c.req.valid('json')
  await db.update(users).set({ weekStartsOn }).where(eq(users.id, user.id))
  const row = await db.select().from(users).where(eq(users.id, user.id)).get()
  return c.json({
    id: row!.id, email: row!.email, name: row!.name,
    weekStartsOn: resolveWeekStartsOn(row!, user),
    weekStartsOnOverride: row!.weekStartsOn,
    dateFormat: user.dateFormat,
    timezone: user.timezone,
  })
})

export { router as usersRouter }
