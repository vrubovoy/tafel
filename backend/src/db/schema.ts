import { sqliteTable, text, integer, uniqueIndex, index, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

// Every timestamp column here uses `mode: 'timestamp_ms'`, not the more
// common `mode: 'timestamp'` - the latter stores epoch *seconds*
// (Math.floor(ms / 1000)) and truncates sub-second precision on every
// round-trip through the DB, which is surprising for `completedAt` (a
// value the API never asked the caller to change can visibly change
// string representation after an unrelated field update). `timestamp_ms`
// stores raw milliseconds and round-trips exactly. Both modes map to the
// same SQL `integer` column type either way - this is a pure
// application-level interpretation choice, not a schema/migration change.

// ── Users (mirrored from Schlüssel via JWT) ───────────────────────
// We store only the user id from the JWT — no passwords here.
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  // Calendar week-start preference: 0 = Sunday, 1 = Monday (matches
  // JS Date#getDay()'s own numbering, so the calendar grid can use this
  // value directly without translating it). Nullable = "no Tafel-specific
  // override" - the effective value (see users/router.ts's GET/PUT /me)
  // then falls back to the platform-wide weekStart schlussel embeds in
  // the JWT, and only to a hardcoded Monday if that's unset too. A user
  // who explicitly picks a value here is choosing to differ from their
  // platform default just within Tafel.
  weekStartsOn: integer('week_starts_on'),
  // Mirrored from the JWT's own weekStart/timezone claims on every
  // request (see middleware/auth.ts's onUserSeen) - "coalesce, don't
  // clobber": a request whose token has no timezone (or an admin/service
  // token, or an old cached token from before this claim existed) never
  // erases an already-known value, it just leaves it as-is. Needed
  // locally (not just read live off the request's own token) because the
  // due-date notification scanner (features/notifications/scanner.ts)
  // runs on a timer, with no request/token in scope at all, and still
  // needs each owner's timezone to compute "is this task due today" per
  // owner rather than in server-local time.
  timezone: text('timezone'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const userTombstones = sqliteTable('user_tombstones', {
  userId: text('user_id').primaryKey(),
  deletionJobId: text('deletion_job_id').notNull().unique(),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }).notNull(),
})

export const deletionJobs = sqliteTable('deletion_jobs', {
  jobId: text('job_id').primaryKey(),
  userId: text('user_id').notNull(),
  tokenId: text('token_id').notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }).notNull(),
})

// ── Projects ──────────────────────────────────────────────────────
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#f59e0b'),
  icon: text('icon').notNull().default('folder'),
  sortOrder: integer('sort_order').notNull().default(0),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

// ── Statuses (per-project, user-customizable kanban columns) ──────
// Seeded with 3 defaults on project creation (To Do / In Progress /
// Done, isDone only on the last) - the user can rename/recolor/reorder/
// add/remove from there. "Done-ness" for stats/recurrence/completedAt
// is driven by isDone, never a literal status name/id comparison.
export const statuses = sqliteTable('statuses', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#94a3b8'),
  sortOrder: integer('sort_order').notNull().default(0),
  isDone: integer('is_done', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

// ── Tasks (self-referencing parentTaskId, arbitrary depth) ────────
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  statusId: text('status_id').notNull().references(() => statuses.id),
  // Self-FK, no depth cap at the schema level - arbitrary nesting is
  // enforced/validated in the router (cycle prevention via a recursive
  // ancestor-chain check), not restricted here. onDelete cascade: hard-
  // deleting a task takes its whole subtree with it; archiving (soft
  // delete) needs its own explicit recursive step since it's a value
  // update, not a row deletion.
  parentTaskId: text('parent_task_id').references((): AnySQLiteColumn => tasks.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  priority: text('priority', { enum: ['low', 'medium', 'high'] }).notNull().default('medium'),
  dueDate: text('due_date'), // ISO YYYY-MM-DD, nullable
  sortOrder: integer('sort_order').notNull().default(0), // order within (parentTaskId, statusId)
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
  // Recurrence is carried to each generated successor so the schedule
  // continues after every completion.
  recurrenceInterval: text('recurrence_interval', { enum: ['daily', 'weekly', 'monthly'] }),
  recurrenceCount: integer('recurrence_count'),
  recurrenceAnchorDate: text('recurrence_anchor_date'), // ISO date the schedule is computed from
  // Stable across generated occurrences. Schedule fields are not an identity:
  // unrelated series can legitimately have the same project, parent, cadence,
  // and dates.
  recurrenceSeriesId: text('recurrence_series_id'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  // Distinguishes tasks hidden by project archiving from tasks that were
  // already archived independently, so project restore does not revive old
  // recurrence instances or explicitly archived task trees.
  archivedByProject: integer('archived_by_project', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

// ── Notifications ───────────────────────────────────────────────────
// Durable domain-level identity for every due/overdue occurrence. Unlike
// terminal transport rows, these records are never retention-cleaned.
export const notificationOccurrences = sqliteTable('notification_occurrences', {
  dedupeKey: text('dedupe_key').primaryKey(),
  createdAt: integer('created_at').notNull(),
})

// Transactional-outbox row for the shared generic dispatcher
// (@zudar107/schloss-server-kit's createNotificationOutboxRuntime, wired
// up in notifications/outbox.ts). `dedupe_key` mirrors Tafel's own dedupe
// policy in notification_occurrences: the due-date scanner computes it as
// `${taskId}:${dueDate}:${occurrence}` (occurrence = 'due-today' or
// 'overdue'). The outbox copy remains unique as an additional transport
// invariant, but is not the durable dedupe identity because terminal outbox
// rows are deleted after their retention period.
export const notificationOutbox = sqliteTable('notification_outbox', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  userId: text('user_id').notNull(),
  payload: text('payload').notNull(),
  correlationId: text('correlation_id').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  state: text('state').notNull().default('pending'),
  createdAt: integer('created_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: integer('next_attempt_at'),
  leaseId: text('lease_id'),
  leaseUntil: integer('lease_until'),
  deliveredAt: integer('delivered_at'),
  permanentAt: integer('permanent_at'),
  lastError: text('last_error'),
}, (table) => [
  uniqueIndex('notification_outbox_dedupe_key_unique').on(table.dedupeKey),
  index('notification_outbox_dispatch_idx').on(table.state, table.nextAttemptAt),
])

export type User = typeof users.$inferSelect
export type Project = typeof projects.$inferSelect
export type Status = typeof statuses.$inferSelect
export type Task = typeof tasks.$inferSelect
export type NotificationOccurrence = typeof notificationOccurrences.$inferSelect
export type NotificationOutboxRow = typeof notificationOutbox.$inferSelect
