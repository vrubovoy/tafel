import Database from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../db/migrations')

describe('notification producer schema', () => {
  it('persists user timezone and creates the dispatcher-compatible outbox', () => {
    const sqlite = new Database(':memory:')

    try {
      migrate(drizzle(sqlite), { migrationsFolder: migrationsDir })

      const userColumns = sqlite.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
      expect(userColumns.map((column) => column.name)).toContain('timezone')

      const outboxColumns = sqlite.prepare('PRAGMA table_info(notification_outbox)').all() as Array<{
        name: string
      }>
      expect(outboxColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
        'id',
        'event_type',
        'user_id',
        'payload',
        'correlation_id',
        'dedupe_key',
        'state',
        'created_at',
        'attempts',
        'next_attempt_at',
        'lease_id',
        'lease_until',
        'delivered_at',
        'last_error',
      ]))
    } finally {
      sqlite.close()
    }
  })

  it('enforces dedupe keys at the database boundary', () => {
    const sqlite = new Database(':memory:')

    try {
      migrate(drizzle(sqlite), { migrationsFolder: migrationsDir })
      const insert = sqlite.prepare(`
        INSERT INTO notification_outbox
          (id, event_type, user_id, payload, correlation_id, dedupe_key, created_at, next_attempt_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      insert.run(
        'event-1',
        'tafel.task.due.v1',
        'user-1',
        '{}',
        'correlation-1',
        'task-1:2026-08-07:due-today',
        1,
        1,
      )

      expect(() => insert.run(
        'event-2',
        'tafel.task.due.v1',
        'user-1',
        '{}',
        'correlation-2',
        'task-1:2026-08-07:due-today',
        2,
        2,
      )).toThrow()
    } finally {
      sqlite.close()
    }
  })
})
