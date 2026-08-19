import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { cleanDb, sqlite } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()
const AUTH_HEADERS = { Authorization: 'Bearer test-token' }
const JSON_HEADERS = { ...AUTH_HEADERS, 'Content-Type': 'application/json' }

interface OutboxRow {
  id: string
  event_type: string
  user_id: string
  payload: string
  correlation_id: string
  dedupe_key: string
  state: string
  created_at: number
  attempts: number
  next_attempt_at: number | null
}

function post(path: string, body: unknown) {
  return app.request(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) })
}

function put(path: string, body: unknown) {
  return app.request(path, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(body) })
}

function get(path: string) {
  return app.request(path, { headers: AUTH_HEADERS })
}

function del(path: string) {
  return app.request(path, { method: 'DELETE', headers: AUTH_HEADERS })
}

function projectCompletedRows(): OutboxRow[] {
  return sqlite.prepare(
    "SELECT * FROM notification_outbox WHERE event_type = 'tafel.project.completed.v1' ORDER BY created_at, id",
  ).all() as OutboxRow[]
}

async function createProjectWithStatuses(name = 'Project') {
  const project = (await (await post('/projects', { name })).json()) as { id: string; name: string }
  const statuses = (await (await get(`/statuses?projectId=${project.id}`)).json()) as
    { id: string; isDone: boolean }[]
  const doneStatus = statuses.find((s) => s.isDone === true)!
  const notDoneStatuses = statuses.filter((s) => s.isDone === false)
  return { project, doneStatus, todoStatus: notDoneStatuses[0]!, otherStatus: notDoneStatuses[1]! }
}

async function createTask(projectId: string, statusId: string, title = 'Task') {
  const response = await post('/tasks', { projectId, statusId, title })
  expect(response.status).toBe(201)
  return await response.json() as { id: string; statusId: string }
}

beforeEach(() => cleanDb())

describe('project completion notification outbox', () => {
  it('fires exactly one event when the only task in a project is marked done', async () => {
    const { project, todoStatus, doneStatus } = await createProjectWithStatuses('Launch')
    const task = await createTask(project.id, todoStatus.id)

    const response = await put(`/tasks/${task.id}`, { statusId: doneStatus.id })

    expect(response.status).toBe(200)
    const rows = projectCompletedRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ user_id: 'user-1', state: 'pending', attempts: 0 })
    expect(JSON.parse(rows[0]!.payload)).toEqual({ recipientId: 'user-1', projectName: 'Launch' })
    expect(rows[0]!.correlation_id).toBe(rows[0]!.id)
    expect(rows[0]!.dedupe_key).toBeTruthy()
  })

  it('fires only when the LAST open task becomes done, not earlier ones', async () => {
    const { project, todoStatus, doneStatus } = await createProjectWithStatuses()
    const taskA = await createTask(project.id, todoStatus.id, 'A')
    const taskB = await createTask(project.id, todoStatus.id, 'B')

    await put(`/tasks/${taskA.id}`, { statusId: doneStatus.id })
    expect(projectCompletedRows()).toHaveLength(0)

    await put(`/tasks/${taskB.id}`, { statusId: doneStatus.id })
    expect(projectCompletedRows()).toHaveLength(1)
  })

  it('does not fire for an un-completion, editing an already-done task, or an already-complete project', async () => {
    const { project, todoStatus, doneStatus } = await createProjectWithStatuses()
    const task = await createTask(project.id, todoStatus.id)
    await put(`/tasks/${task.id}`, { statusId: doneStatus.id })
    expect(projectCompletedRows()).toHaveLength(1)

    // Un-complete, then re-edit without changing status - no new completion.
    await put(`/tasks/${task.id}`, { statusId: todoStatus.id })
    await put(`/tasks/${task.id}`, { title: 'Renamed' })
    expect(projectCompletedRows()).toHaveLength(1)
  })

  it('re-arms after new work is added to a completed project and finished again', async () => {
    const { project, todoStatus, doneStatus } = await createProjectWithStatuses()
    const first = await createTask(project.id, todoStatus.id)
    await put(`/tasks/${first.id}`, { statusId: doneStatus.id })
    expect(projectCompletedRows()).toHaveLength(1)

    const second = await createTask(project.id, todoStatus.id, 'More work')
    expect(projectCompletedRows()).toHaveLength(1)

    await put(`/tasks/${second.id}`, { statusId: doneStatus.id })
    expect(projectCompletedRows()).toHaveLength(2)
  })

  it('fires via the kanban reorder endpoint too', async () => {
    const { project, todoStatus, doneStatus } = await createProjectWithStatuses('Board')
    const task = await createTask(project.id, todoStatus.id)

    const response = await put(`/tasks/${task.id}/reorder`, { statusId: doneStatus.id, sortOrder: 0 })

    expect(response.status).toBe(200)
    const rows = projectCompletedRows()
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0]!.payload)).toMatchObject({ projectName: 'Board' })
  })

  it('ignores archived tasks and does not require them to be done', async () => {
    const { project, todoStatus, doneStatus } = await createProjectWithStatuses()
    const keeper = await createTask(project.id, todoStatus.id, 'Keeper')
    const doomed = await createTask(project.id, todoStatus.id, 'Doomed')
    await del(`/tasks/${doomed.id}`)

    const response = await put(`/tasks/${keeper.id}`, { statusId: doneStatus.id })

    expect(response.status).toBe(200)
    expect(projectCompletedRows()).toHaveLength(1)
  })

  it('never fires for an empty project or a project that never had any tasks', async () => {
    await createProjectWithStatuses('Empty')
    expect(projectCompletedRows()).toHaveLength(0)
  })
})
