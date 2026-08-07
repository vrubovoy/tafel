import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../db/migrations')

describe('database migrations', () => {
  it('0002 preserves an existing user/project/status/task graph with the production migrator', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    try {
      for (const migration of ['0000_gigantic_gorgon.sql', '0001_colorful_mandroid.sql']) {
        sqlite.exec(readFileSync(resolve(migrationsDir, migration), 'utf8'))
      }

      const journal = JSON.parse(
        readFileSync(resolve(migrationsDir, 'meta/_journal.json'), 'utf8'),
      ) as { entries: Array<{ tag: string; when: number }> }
      const migration0001 = journal.entries.find((entry) => entry.tag === '0001_colorful_mandroid')!
      sqlite.exec(`
        CREATE TABLE __drizzle_migrations (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at numeric
        );
      `)
      sqlite.prepare(
        'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
      ).run('pre-0002-test-fixture', migration0001.when)

      const now = Date.UTC(2026, 0, 1)
      sqlite.prepare(
        'INSERT INTO users (id, email, name, week_starts_on, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run('user-existing', 'existing@example.com', 'Existing User', 1, now)
      sqlite.prepare(
        `INSERT INTO projects
          (id, user_id, name, color, icon, sort_order, archived, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'project-existing', 'user-existing', 'Existing Project', '#123456', 'star', 7, 0, now,
      )
      sqlite.prepare(
        `INSERT INTO statuses
          (id, project_id, name, color, sort_order, is_done, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run('status-existing', 'project-existing', 'To Do', '#654321', 4, 0, now)
      sqlite.prepare(
        `INSERT INTO tasks
          (id, user_id, project_id, status_id, title, description, priority, due_date,
           sort_order, completed_at, recurrence_interval, recurrence_count,
           recurrence_anchor_date, archived, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'task-existing',
        'user-existing',
        'project-existing',
        'status-existing',
        'Existing Task',
        'Existing description',
        'high',
        '2026-02-03',
        9,
        now,
        'weekly',
        2,
        '2026-02-03',
        0,
        now,
      )

      migrate(drizzle(sqlite), { migrationsFolder: migrationsDir })

      expect(sqlite.prepare('SELECT * FROM users WHERE id = ?').get('user-existing')).toMatchObject({
        id: 'user-existing',
        week_starts_on: 1,
      })
      expect(sqlite.prepare('SELECT * FROM projects WHERE id = ?').get('project-existing')).toMatchObject({
        id: 'project-existing',
        user_id: 'user-existing',
        name: 'Existing Project',
        color: '#123456',
        icon: 'star',
        sort_order: 7,
        archived: 0,
        created_at: now,
      })
      expect(sqlite.prepare('SELECT * FROM statuses WHERE id = ?').get('status-existing')).toMatchObject({
        id: 'status-existing',
        project_id: 'project-existing',
        name: 'To Do',
        color: '#654321',
        sort_order: 4,
        is_done: 0,
        created_at: now,
      })
      expect(sqlite.prepare('SELECT * FROM tasks WHERE id = ?').get('task-existing')).toMatchObject({
        id: 'task-existing',
        user_id: 'user-existing',
        project_id: 'project-existing',
        status_id: 'status-existing',
        title: 'Existing Task',
        description: 'Existing description',
        priority: 'high',
        due_date: '2026-02-03',
        sort_order: 9,
        completed_at: now,
        recurrence_interval: 'weekly',
        recurrence_count: 2,
        recurrence_anchor_date: '2026-02-03',
        recurrence_series_id: 'task-existing',
        archived: 0,
        archived_by_project: 0,
        created_at: now,
      })
      sqlite.prepare('UPDATE users SET week_starts_on = NULL WHERE id = ?').run('user-existing')
      expect(sqlite.prepare('SELECT week_starts_on FROM users WHERE id = ?').get('user-existing'))
        .toEqual({ week_starts_on: null })
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    } finally {
      sqlite.close()
    }
  })

  it('backfills archivedByProject for tasks already archived with their project', () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    try {
      for (const migration of [
        '0000_gigantic_gorgon.sql',
        '0001_colorful_mandroid.sql',
        '0002_yummy_thunderbolts.sql',
      ]) {
        sqlite.exec(readFileSync(resolve(migrationsDir, migration), 'utf8'))
      }

      const journal = JSON.parse(
        readFileSync(resolve(migrationsDir, 'meta/_journal.json'), 'utf8'),
      ) as { entries: Array<{ tag: string; when: number }> }
      const migration0002 = journal.entries.find((entry) => entry.tag === '0002_yummy_thunderbolts')!
      sqlite.exec(`
        CREATE TABLE __drizzle_migrations (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at numeric
        );
      `)
      sqlite.prepare(
        'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
      ).run('pre-0003-test-fixture', migration0002.when)

      const now = Date.UTC(2026, 0, 1)
      sqlite.prepare(
        'INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)',
      ).run('user-archived', 'archived@example.com', 'Archived User', now)
      sqlite.prepare(
        `INSERT INTO projects
          (id, user_id, name, color, icon, sort_order, archived, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('project-archived', 'user-archived', 'Archived Project', '#123456', 'folder', 0, 1, now)
      sqlite.prepare(
        `INSERT INTO statuses
          (id, project_id, name, color, sort_order, is_done, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run('status-archived', 'project-archived', 'To Do', '#654321', 0, 0, now)
      sqlite.prepare(
        `INSERT INTO tasks
          (id, user_id, project_id, status_id, title, priority, sort_order, archived, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'task-archived', 'user-archived', 'project-archived', 'status-archived',
        'Archived with project', 'medium', 0, 1, now,
      )

      migrate(drizzle(sqlite), { migrationsFolder: migrationsDir })

      expect(sqlite.prepare(
        'SELECT archived, archived_by_project FROM tasks WHERE id = ?',
      ).get('task-archived')).toEqual({
        archived: 1,
        archived_by_project: 1,
      })
    } finally {
      sqlite.close()
    }
  })
})
