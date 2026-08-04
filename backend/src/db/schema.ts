import { sqliteTable, text, integer, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

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
  // value directly without translating it).
  weekStartsOn: integer('week_starts_on').notNull().default(1),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
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
  // Recurrence lives only on the template task; regenerated instances
  // have these fields null (they don't themselves recur).
  recurrenceInterval: text('recurrence_interval', { enum: ['daily', 'weekly', 'monthly'] }),
  recurrenceCount: integer('recurrence_count'),
  recurrenceAnchorDate: text('recurrence_anchor_date'), // ISO date the schedule is computed from
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export type User = typeof users.$inferSelect
export type Project = typeof projects.$inferSelect
export type Status = typeof statuses.$inferSelect
export type Task = typeof tasks.$inferSelect
