import Database from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
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
        'permanent_at',
        'last_error',
      ]))

      const occurrenceColumns = sqlite.prepare('PRAGMA table_info(notification_occurrences)').all() as Array<{
        name: string
      }>
      expect(occurrenceColumns.map((column) => column.name)).toEqual(['dedupe_key', 'created_at'])
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

  it('keeps notification occurrence identities unique outside the disposable outbox', () => {
    const sqlite = new Database(':memory:')

    try {
      migrate(drizzle(sqlite), { migrationsFolder: migrationsDir })
      const insert = sqlite.prepare(
        'INSERT INTO notification_occurrences (dedupe_key, created_at) VALUES (?, ?)',
      )
      insert.run('task-1:2026-08-07:overdue', 1)

      expect(() => insert.run('task-1:2026-08-07:overdue', 2)).toThrow()
    } finally {
      sqlite.close()
    }
  })

  it('backfills durable occurrence identities from an existing outbox', () => {
    const sqlite = new Database(':memory:')

    try {
      sqlite.exec(`
        CREATE TABLE notification_outbox (
          dedupe_key text PRIMARY KEY NOT NULL,
          created_at integer NOT NULL
        );
        INSERT INTO notification_outbox (dedupe_key, created_at)
        VALUES ('task-1:2026-08-07:overdue', 1234);
      `)
      const migration = readFileSync(resolve(migrationsDir, '0006_little_psylocke.sql'), 'utf8')
      for (const statement of migration.split('--> statement-breakpoint')) {
        sqlite.exec(statement)
      }

      expect(sqlite.prepare('SELECT * FROM notification_occurrences').all()).toEqual([
        { dedupe_key: 'task-1:2026-08-07:overdue', created_at: 1234 },
      ])
    } finally {
      sqlite.close()
    }
  })

  it('backfills a terminal timestamp only for existing permanent rows', () => {
    const sqlite = new Database(':memory:')

    try {
      sqlite.exec(`
        CREATE TABLE notification_outbox (
          id text PRIMARY KEY NOT NULL,
          state text NOT NULL,
          created_at integer NOT NULL
        );
        INSERT INTO notification_outbox (id, state, created_at)
        VALUES ('permanent', 'permanent', 1), ('pending', 'pending', 1);
      `)
      const migration = readFileSync(resolve(migrationsDir, '0007_yellow_zzzax.sql'), 'utf8')
      for (const statement of migration.split('--> statement-breakpoint')) {
        sqlite.exec(statement)
      }

      const rows = sqlite.prepare(
        'SELECT id, permanent_at FROM notification_outbox ORDER BY id',
      ).all() as Array<{ id: string, permanent_at: number | null }>
      expect(rows[0]).toEqual({ id: 'pending', permanent_at: null })
      expect(rows[1]?.id).toBe('permanent')
      expect(rows[1]?.permanent_at).toBeGreaterThan(0)
    } finally {
      sqlite.close()
    }
  })
})
