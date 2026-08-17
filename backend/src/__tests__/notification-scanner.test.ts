import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))

import { scanTaskDueNotifications } from '../features/notifications/scanner.js'
import { cleanDb, db, sqlite } from './helpers/db.js'

const NOW = new Date('2026-08-08T02:30:00.000Z')
let nextId = 0

function scan(now = NOW) {
  return scanTaskDueNotifications({
    now: () => now,
    createId: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`,
  })
}

function addOwner(id: string, timezone: string) {
  sqlite.prepare(
    'INSERT INTO users (id, email, name, timezone, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, `${id}@example.com`, id, timezone, NOW.getTime())
}

function addProject(id: string, userId: string, archived = false) {
  sqlite.prepare(`
    INSERT INTO projects (id, user_id, name, color, icon, sort_order, archived, created_at)
    VALUES (?, ?, ?, '#123456', 'folder', 0, ?, ?)
  `).run(id, userId, id, Number(archived), NOW.getTime())
}

function addStatus(id: string, projectId: string, isDone = false) {
  sqlite.prepare(`
    INSERT INTO statuses (id, project_id, name, color, sort_order, is_done, created_at)
    VALUES (?, ?, ?, '#123456', 0, ?, ?)
  `).run(id, projectId, id, Number(isDone), NOW.getTime())
}

function addTask(options: {
  id: string
  userId: string
  projectId: string
  statusId: string
  dueDate: string | null
  archived?: boolean
  completedAt?: number | null
}) {
  sqlite.prepare(`
    INSERT INTO tasks
      (id, user_id, project_id, status_id, title, priority, due_date, sort_order,
       completed_at, archived, created_at)
    VALUES (?, ?, ?, ?, ?, 'medium', ?, 0, ?, ?, ?)
  `).run(
    options.id,
    options.userId,
    options.projectId,
    options.statusId,
    `Title ${options.id}`,
    options.dueDate,
    options.completedAt ?? null,
    Number(options.archived ?? false),
    NOW.getTime(),
  )
}

function outboxRows() {
  return sqlite.prepare(`
    SELECT id, event_type, user_id, payload, correlation_id, dedupe_key, state
    FROM notification_outbox ORDER BY user_id, payload
  `).all() as Array<{
    id: string
    event_type: string
    user_id: string
    payload: string
    correlation_id: string
    dedupe_key: string
    state: string
  }>
}

beforeEach(() => {
  sqlite.exec('DELETE FROM notification_outbox')
  sqlite.exec('DELETE FROM notification_occurrences')
  cleanDb()
  sqlite.prepare("DELETE FROM users WHERE id NOT IN ('user-1', 'user-2')").run()
  nextId = 0
})

describe('task due notification scanner', () => {
  it('uses each owner timezone and emits the versioned due-today payload', async () => {
    addOwner('utc-owner', 'UTC')
    addOwner('la-owner', 'America/Los_Angeles')
    addProject('utc-project', 'utc-owner')
    addProject('la-project', 'la-owner')
    addStatus('utc-todo', 'utc-project')
    addStatus('la-todo', 'la-project')
    addTask({
      id: 'utc-task', userId: 'utc-owner', projectId: 'utc-project', statusId: 'utc-todo', dueDate: '2026-08-08',
    })
    addTask({
      id: 'la-task', userId: 'la-owner', projectId: 'la-project', statusId: 'la-todo', dueDate: '2026-08-07',
    })

    await scan()

    const rows = outboxRows()
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => ({
      type: row.event_type,
      recipient: row.user_id,
      payload: JSON.parse(row.payload) as unknown,
      pending: row.state,
      selfCorrelated: row.correlation_id === row.id,
    }))).toEqual([
      {
        type: 'tafel.task.due.v1',
        recipient: 'la-owner',
        payload: {
          recipientId: 'la-owner', taskTitle: 'Title la-task', dueDate: '2026-08-07', overdue: false,
        },
        pending: 'pending',
        selfCorrelated: true,
      },
      {
        type: 'tafel.task.due.v1',
        recipient: 'utc-owner',
        payload: {
          recipientId: 'utc-owner', taskTitle: 'Title utc-task', dueDate: '2026-08-08', overdue: false,
        },
        pending: 'pending',
        selfCorrelated: true,
      },
    ])
  })

  it('emits one due-today and one overdue occurrence, with reruns deduplicated', async () => {
    addOwner('owner', 'UTC')
    addProject('project', 'owner')
    addStatus('todo', 'project')
    addTask({ id: 'task', userId: 'owner', projectId: 'project', statusId: 'todo', dueDate: '2026-08-08' })

    await scan(new Date('2026-08-08T12:00:00.000Z'))
    await scan(new Date('2026-08-08T18:00:00.000Z'))
    await scan(new Date('2026-08-09T12:00:00.000Z'))
    await scan(new Date('2026-08-10T12:00:00.000Z'))

    const rows = outboxRows()
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => (JSON.parse(row.payload) as { overdue: boolean }).overdue).sort()).toEqual([
      false,
      true,
    ])
    expect(new Set(rows.map((row) => row.dedupe_key)).size).toBe(2)
  })

  it('allows a changed due date to produce a new occurrence', async () => {
    addOwner('owner', 'UTC')
    addProject('project', 'owner')
    addStatus('todo', 'project')
    addTask({ id: 'task', userId: 'owner', projectId: 'project', statusId: 'todo', dueDate: '2026-08-08' })

    await scan(new Date('2026-08-08T12:00:00.000Z'))
    sqlite.prepare("UPDATE tasks SET due_date = '2026-08-09' WHERE id = 'task'").run()
    await scan(new Date('2026-08-09T12:00:00.000Z'))

    expect(outboxRows().map((row) => {
      const payload = JSON.parse(row.payload) as { dueDate: string }
      return payload.dueDate
    }).sort()).toEqual(['2026-08-08', '2026-08-09'])
  })

  it('does not repeat an overdue occurrence after its terminal outbox row is retained away', async () => {
    addOwner('owner', 'UTC')
    addProject('project', 'owner')
    addStatus('todo', 'project')
    addTask({ id: 'task', userId: 'owner', projectId: 'project', statusId: 'todo', dueDate: '2026-08-07' })

    expect(await scan()).toBe(1)
    sqlite.exec('DELETE FROM notification_outbox')
    expect(await scan(new Date('2026-08-09T12:00:00.000Z'))).toBe(0)

    expect(outboxRows()).toEqual([])
    expect(sqlite.prepare('SELECT dedupe_key FROM notification_occurrences').all()).toEqual([
      { dedupe_key: 'task:2026-08-07:overdue' },
    ])
  })

  it('skips completed, done, archived, project-archived, and undated tasks', async () => {
    addOwner('owner', 'UTC')
    addProject('active-project', 'owner')
    addProject('archived-project', 'owner', true)
    addStatus('todo', 'active-project')
    addStatus('done', 'active-project', true)
    addStatus('archived-project-todo', 'archived-project')
    addTask({
      id: 'completed', userId: 'owner', projectId: 'active-project', statusId: 'todo',
      dueDate: '2026-08-08', completedAt: NOW.getTime(),
    })
    addTask({
      id: 'done', userId: 'owner', projectId: 'active-project', statusId: 'done', dueDate: '2026-08-08',
    })
    addTask({
      id: 'archived', userId: 'owner', projectId: 'active-project', statusId: 'todo',
      dueDate: '2026-08-08', archived: true,
    })
    addTask({
      id: 'archived-project-task', userId: 'owner', projectId: 'archived-project',
      statusId: 'archived-project-todo', dueDate: '2026-08-08',
    })
    addTask({
      id: 'undated', userId: 'owner', projectId: 'active-project', statusId: 'todo', dueDate: null,
    })

    await scan()

    expect(outboxRows()).toEqual([])
  })

  it.each([
    ['task', "UPDATE tasks SET archived = 1 WHERE id = 'task'"],
    ['project', "UPDATE projects SET archived = 1 WHERE id = 'project'"],
    ['status', "UPDATE statuses SET is_done = 1 WHERE id = 'todo'"],
    ['due date', "UPDATE tasks SET due_date = '2026-08-09' WHERE id = 'task'"],
    ['owner timezone', "UPDATE users SET timezone = 'America/Los_Angeles' WHERE id = 'owner'"],
  ])('transactionally rechecks the current %s before enqueueing a selected candidate', async (_field, mutation) => {
    addOwner('owner', 'UTC')
    addProject('project', 'owner')
    addStatus('todo', 'project')
    addTask({ id: 'task', userId: 'owner', projectId: 'project', statusId: 'todo', dueDate: '2026-08-08' })
    const transaction = db.transaction.bind(db)
    const transactionSpy = vi.spyOn(db, 'transaction').mockImplementation(((callback, config) => {
      sqlite.exec(mutation)
      return transaction(callback, config)
    }) as typeof db.transaction)

    try {
      const emitted = await scan()

      expect(transactionSpy).toHaveBeenCalled()
      expect(emitted).toBe(0)
      expect(outboxRows()).toEqual([])
    } finally {
      transactionSpy.mockRestore()
    }
  })
})
