import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as schema from '../../db/schema.js'
import { migrateDatabase } from '../../db/migrate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const sqlite = new Database(':memory:')
sqlite.pragma('foreign_keys = ON')

// The real migrateDatabase() (not hand-rolled raw-SQL execution) so it
// also populates __drizzle_migrations - assertDatabaseCurrent() checks
// that table, and /ready now calls it for real via helpers/setup.ts's
// reconstructed route.
migrateDatabase(sqlite, resolve(__dirname, '../../db/migrations'))

// Insert the two test users — they persist for the lifetime of this DB instance.
// Do NOT delete users in beforeEach cleanup.
const now = Date.now()
sqlite.prepare(
  'INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)',
).run('user-1', 'test@example.com', 'Test User', now)
sqlite.prepare(
  'INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)',
).run('user-2', 'test2@example.com', 'Test User 2', now)

export const db = drizzle(sqlite, { schema })

/**
 * Delete all data rows (not users) between tests.
 * Order respects FK constraints: delete dependents before parents
 * (tasks references statuses/projects, statuses references projects).
 */
export function cleanDb() {
  const tables = ['tasks', 'statuses', 'projects', 'notification_outbox', 'notification_occurrences']
  for (const t of tables) sqlite.exec(`DELETE FROM ${t}`)
}
