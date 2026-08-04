import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { readdirSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as schema from '../../db/schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const sqlite = new Database(':memory:')
sqlite.pragma('foreign_keys = ON')

// Run every migration file in order (not just the first one) - the
// numeric filename prefix drizzle-kit generates already sorts correctly.
const migrationsDir = resolve(__dirname, '../../db/migrations')
const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
for (const file of migrationFiles) {
  const migrationSql = readFileSync(resolve(migrationsDir, file), 'utf-8')
  for (const stmt of migrationSql.split('--> statement-breakpoint')) {
    const s = stmt.trim()
    if (s) sqlite.exec(s)
  }
}

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
  const tables = ['tasks', 'statuses', 'projects']
  for (const t of tables) sqlite.exec(`DELETE FROM ${t}`)
}
