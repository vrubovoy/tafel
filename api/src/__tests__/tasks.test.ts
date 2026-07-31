import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()

const H1 = { Authorization: 'Bearer test-token' }
const JSON_H1 = { ...H1, 'Content-Type': 'application/json' }

const get = (path: string, headers = H1) => app.request(path, { headers })
const post = (path: string, body: unknown, headers = JSON_H1) =>
  app.request(path, { method: 'POST', headers, body: JSON.stringify(body) })
const put = (path: string, body: unknown, headers = JSON_H1) =>
  app.request(path, { method: 'PUT', headers, body: JSON.stringify(body) })
const del = (path: string, headers = H1) => app.request(path, { method: 'DELETE', headers })

beforeEach(() => cleanDb())

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d!))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

async function createProjectWithStatuses(name = 'Project') {
  const project = (await (await post('/projects', { name })).json()) as any
  const statuses = (await (await get(`/statuses?projectId=${project.id}`)).json()) as any[]
  const doneStatus = statuses.find((s) => s.isDone === true)!
  const notDoneStatuses = statuses.filter((s) => s.isDone === false)
  return { project, statuses, doneStatus, todoStatus: notDoneStatuses[0]!, otherStatus: notDoneStatuses[1]! }
}

describe('GET /tasks', () => {
  it('returns empty array when no tasks', async () => {
    const res = await get('/tasks')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('returns tasks with the expected shape', async () => {
    const { project, todoStatus } = await createProjectWithStatuses()
    await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Task A' })
    const body = (await (await get('/tasks')).json()) as any[]
    expect(body).toHaveLength(1)
    const t = body[0]!
    for (const key of [
      'id', 'userId', 'projectId', 'parentTaskId', 'statusId', 'title', 'description',
      'priority', 'dueDate', 'sortOrder', 'completedAt', 'recurrenceInterval',
      'recurrenceCount', 'recurrenceAnchorDate', 'archived', 'createdAt',
    ]) {
      expect(t).toHaveProperty(key)
    }
    expect(t.userId).toBe('user-1')
    expect(t.title).toBe('Task A')
  })

  it('filters by projectId', async () => {
    const { project: p1, todoStatus: s1 } = await createProjectWithStatuses('P1')
    const { project: p2, todoStatus: s2 } = await createProjectWithStatuses('P2')
    await post('/tasks', { projectId: p1.id, statusId: s1.id, title: 'In P1' })
    await post('/tasks', { projectId: p2.id, statusId: s2.id, title: 'In P2' })

    const list = (await (await get(`/tasks?projectId=${p1.id}`)).json()) as any[]
    expect(list).toHaveLength(1)
    expect(list[0]!.title).toBe('In P1')
  })

  it('filters by parentTaskId=<id> to direct children only', async () => {
    const { project, todoStatus } = await createProjectWithStatuses()
    const parent = (await (
      await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Parent' })
    ).json()) as any
    const child = (await (
      await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Child', parentTaskId: parent.id })
    ).json()) as any
    await post('/tasks', {
      projectId: project.id, statusId: todoStatus.id, title: 'Grandchild', parentTaskId: child.id,
    })

    const list = (await (await get(`/tasks?parentTaskId=${parent.id}`)).json()) as any[]
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(child.id)
  })

  it('filters by parentTaskId= (empty) to top-level tasks only', async () => {
    const { project, todoStatus } = await createProjectWithStatuses()
    const parent = (await (
      await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Parent' })
    ).json()) as any
    await post('/tasks', {
      projectId: project.id, statusId: todoStatus.id, title: 'Child', parentTaskId: parent.id,
    })

    const list = (await (await get('/tasks?parentTaskId=')).json()) as any[]
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(parent.id)
    expect(list[0]!.parentTaskId).toBeNull()
  })

  it('returns tasks at every depth when parentTaskId is omitted entirely', async () => {
    const { project, todoStatus } = await createProjectWithStatuses()
    const parent = (await (
      await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Parent' })
    ).json()) as any
    await post('/tasks', {
      projectId: project.id, statusId: todoStatus.id, title: 'Child', parentTaskId: parent.id,
    })

    const list = (await (await get(`/tasks?projectId=${project.id}`)).json()) as any[]
    expect(list).toHaveLength(2)
  })

  it('filters by statusId', async () => {
    const { project, todoStatus, otherStatus } = await createProjectWithStatuses()
    await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'In todo' })
    await post('/tasks', { projectId: project.id, statusId: otherStatus.id, title: 'In other' })

    const list = (await (await get(`/tasks?statusId=${todoStatus.id}`)).json()) as any[]
    expect(list).toHaveLength(1)
    expect(list[0]!.title).toBe('In todo')
  })

  it('filters by from/to date range inclusively and excludes null dueDate tasks', async () => {
    const { project, todoStatus } = await createProjectWithStatuses()
    await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Before', dueDate: '2026-01-01' })
    await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'InRange', dueDate: '2026-01-15' })
    await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'EdgeStart', dueDate: '2026-01-10' })
    await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'EdgeEnd', dueDate: '2026-01-20' })
    await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'After', dueDate: '2026-02-01' })
    await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'NoDueDate' })

    const list = (await (await get(`/tasks?projectId=${project.id}&from=2026-01-10&to=2026-01-20`)).json()) as any[]
    const titles = list.map((t) => t.title).sort()
    expect(titles).toEqual(['EdgeEnd', 'EdgeStart', 'InRange'])
  })

  it('excludes archived tasks', async () => {
    const { project, todoStatus } = await createProjectWithStatuses()
    const task = (await (
      await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'ToArchive' })
    ).json()) as any
    await del(`/tasks/${task.id}`)

    const list = (await (await get(`/tasks?projectId=${project.id}`)).json()) as any[]
    expect(list).toEqual([])
  })
})

describe('POST /tasks', () => {
  it('creates a task with defaults', async () => {
    const { project, todoStatus } = await createProjectWithStatuses()
    const res = await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Minimal' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as any
    expect(body.title).toBe('Minimal')
    expect(body.parentTaskId).toBeNull()
    expect(body.description).toBeNull()
    expect(body.priority).toBe('medium')
    expect(body.dueDate).toBeNull()
    expect(body.sortOrder).toBe(0)
    expect(body.recurrenceInterval).toBeNull()
    expect(body.recurrenceCount).toBeNull()
    expect(body.userId).toBe('user-1')
    expect(body.projectId).toBe(project.id)
    expect(body.statusId).toBe(todoStatus.id)
  })

  it('creates a task with all fields overridden', async () => {
    const { project, todoStatus } = await createProjectWithStatuses()
    const res = await post('/tasks', {
      projectId: project.id,
      statusId: todoStatus.id,
      title: 'Full',
      description: 'Details here',
      priority: 'high',
      dueDate: '2026-08-01',
      sortOrder: 3,
      recurrenceInterval: 'weekly',
      recurrenceCount: 4,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as any
    expect(body.description).toBe('Details here')
    expect(body.priority).toBe('high')
    expect(body.dueDate).toBe('2026-08-01')
    expect(body.sortOrder).toBe(3)
    expect(body.recurrenceInterval).toBe('weekly')
    expect(body.recurrenceCount).toBe(4)
  })

  it('returns 404 when projectId is not owned/found', async () => {
    const { todoStatus } = await createProjectWithStatuses()
    const res = await post('/tasks', { projectId: 'nonexistent', statusId: todoStatus.id, title: 'X' })
    expect(res.status).toBe(404)
  })

  it("returns 404 when statusId doesn't belong to projectId", async () => {
    const { project: p1 } = await createProjectWithStatuses('P1')
    const { todoStatus: s2 } = await createProjectWithStatuses('P2')
    const res = await post('/tasks', { projectId: p1.id, statusId: s2.id, title: 'X' })
    expect(res.status).toBe(404)
  })

  it("returns 404 when parentTaskId is given but doesn't exist", async () => {
    const { project, todoStatus } = await createProjectWithStatuses()
    const res = await post('/tasks', {
      projectId: project.id, statusId: todoStatus.id, title: 'X', parentTaskId: 'nonexistent',
    })
    expect(res.status).toBe(404)
  })

  it('sets completedAt immediately when statusId is a done status', async () => {
    const { project, doneStatus } = await createProjectWithStatuses()
    const res = await post('/tasks', { projectId: project.id, statusId: doneStatus.id, title: 'DoneFromStart' })
    const body = (await res.json()) as any
    expect(body.completedAt).not.toBeNull()
  })

  it('leaves completedAt null when statusId is not a done status', async () => {
    const { project, todoStatus } = await createProjectWithStatuses()
    const res = await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'NotDone' })
    const body = (await res.json()) as any
    expect(body.completedAt).toBeNull()
  })

  it('returns 400 when required fields are missing', async () => {
    const { project } = await createProjectWithStatuses()
    const res = await post('/tasks', { projectId: project.id })
    expect(res.status).toBe(400)
  })
})

describe('PUT /tasks/:id', () => {
  it('updates a task with a partial body and returns merged fields', async () => {
    const { project, todoStatus } = await createProjectWithStatuses()
    const task = (await (
      await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Old title' })
    ).json()) as any
    const res = await put(`/tasks/${task.id}`, { title: 'New title', priority: 'low' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.title).toBe('New title')
    expect(body.priority).toBe('low')
    expect(body.id).toBe(task.id)
  })

  it('returns 404 for an unknown id', async () => {
    const res = await put('/tasks/nonexistent', { title: 'X' })
    expect(res.status).toBe(404)
  })

  it('returns 404 when updated statusId does not belong to the project', async () => {
    const { project: p1, todoStatus: s1 } = await createProjectWithStatuses('P1')
    const { todoStatus: s2 } = await createProjectWithStatuses('P2')
    const task = (await (
      await post('/tasks', { projectId: p1.id, statusId: s1.id, title: 'X' })
    ).json()) as any
    const res = await put(`/tasks/${task.id}`, { statusId: s2.id })
    expect(res.status).toBe(404)
  })

  it('sets completedAt when statusId transitions from not-done to done', async () => {
    const { project, todoStatus, doneStatus } = await createProjectWithStatuses()
    const task = (await (
      await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'X' })
    ).json()) as any
    expect(task.completedAt).toBeNull()

    const res = await put(`/tasks/${task.id}`, { statusId: doneStatus.id })
    const body = (await res.json()) as any
    expect(body.completedAt).not.toBeNull()
  })

  it('clears completedAt when statusId transitions from done to not-done', async () => {
    const { project, todoStatus, doneStatus } = await createProjectWithStatuses()
    const task = (await (
      await post('/tasks', { projectId: project.id, statusId: doneStatus.id, title: 'X' })
    ).json()) as any
    expect(task.completedAt).not.toBeNull()

    const res = await put(`/tasks/${task.id}`, { statusId: todoStatus.id })
    const body = (await res.json()) as any
    expect(body.completedAt).toBeNull()
  })

  // SUSPECTED BUG (see test report): completedAt is observed to be
  // overwritten with a fresh (and oddly whole-second-truncated) timestamp
  // whenever statusId changes to any isDone status, rather than being left
  // unchanged when moving between two already-isDone statuses as the spec
  // describes.
  it('leaves completedAt unchanged when moving between two done statuses', async () => {
    const { project, doneStatus } = await createProjectWithStatuses()
    const secondDone = (await (
      await post('/statuses', { projectId: project.id, name: 'AlsoDone', isDone: true })
    ).json()) as any
    const task = (await (
      await post('/tasks', { projectId: project.id, statusId: doneStatus.id, title: 'X' })
    ).json()) as any
    const originalCompletedAt = task.completedAt
    expect(originalCompletedAt).not.toBeNull()

    // Ensure some time passes so a fresh timestamp would differ from the original.
    await new Promise((resolve) => setTimeout(resolve, 5))

    const res = await put(`/tasks/${task.id}`, { statusId: secondDone.id })
    const body = (await res.json()) as any
    expect(body.completedAt).toBe(originalCompletedAt)
  })
})

describe('cycle prevention and cross-project parent (see also isolation.test.ts)', () => {
  it('returns 422 when setting parentTaskId to the task itself', async () => {
    const { project, todoStatus } = await createProjectWithStatuses()
    const task = (await (
      await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Self' })
    ).json()) as any
    const res = await put(`/tasks/${task.id}`, { parentTaskId: task.id })
    expect(res.status).toBe(422)
  })

  it('returns 422 when setting parentTaskId to a descendant', async () => {
    const { project, todoStatus } = await createProjectWithStatuses()
    const grandparent = (await (
      await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'GP' })
    ).json()) as any
    const parent = (await (
      await post('/tasks', {
        projectId: project.id, statusId: todoStatus.id, title: 'P', parentTaskId: grandparent.id,
      })
    ).json()) as any
    const child = (await (
      await post('/tasks', {
        projectId: project.id, statusId: todoStatus.id, title: 'C', parentTaskId: parent.id,
      })
    ).json()) as any

    const res = await put(`/tasks/${grandparent.id}`, { parentTaskId: child.id })
    expect(res.status).toBe(422)

    const unchanged = (await (await get(`/tasks?parentTaskId=`)).json()) as any[]
    expect(unchanged.find((t) => t.id === grandparent.id)).toBeDefined()
  })
})

describe('DELETE /tasks/:id', () => {
  it('recursively archives every descendant at every depth', async () => {
    const { project, todoStatus } = await createProjectWithStatuses()
    const top = (await (
      await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Top' })
    ).json()) as any
    const sub = (await (
      await post('/tasks', {
        projectId: project.id, statusId: todoStatus.id, title: 'Sub', parentTaskId: top.id,
      })
    ).json()) as any
    const subsub = (await (
      await post('/tasks', {
        projectId: project.id, statusId: todoStatus.id, title: 'SubSub', parentTaskId: sub.id,
      })
    ).json()) as any

    const res = await del(`/tasks/${top.id}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const remaining = (await (await get(`/tasks?projectId=${project.id}`)).json()) as any[]
    const remainingIds = remaining.map((t) => t.id)
    expect(remainingIds).not.toContain(top.id)
    expect(remainingIds).not.toContain(sub.id)
    expect(remainingIds).not.toContain(subsub.id)
  })

  it('returns 404 for an unknown id', async () => {
    const res = await del('/tasks/nonexistent')
    expect(res.status).toBe(404)
  })
})

describe('PUT /tasks/:id/reorder', () => {
  it('updates statusId and sortOrder without touching other fields', async () => {
    const { project, todoStatus, otherStatus } = await createProjectWithStatuses()
    const task = (await (
      await post('/tasks', {
        projectId: project.id, statusId: todoStatus.id, title: 'Keep title', description: 'Keep desc',
      })
    ).json()) as any

    const res = await app.request(`/tasks/${task.id}/reorder`, {
      method: 'PUT', headers: JSON_H1, body: JSON.stringify({ statusId: otherStatus.id, sortOrder: 7 }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.statusId).toBe(otherStatus.id)
    expect(body.sortOrder).toBe(7)
    expect(body.title).toBe('Keep title')
    expect(body.description).toBe('Keep desc')
  })

  it('recomputes completedAt using the same isDone-transition rules', async () => {
    const { project, todoStatus, doneStatus } = await createProjectWithStatuses()
    const task = (await (
      await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'X' })
    ).json()) as any

    const res = await app.request(`/tasks/${task.id}/reorder`, {
      method: 'PUT', headers: JSON_H1, body: JSON.stringify({ statusId: doneStatus.id, sortOrder: 0 }),
    })
    const body = (await res.json()) as any
    expect(body.completedAt).not.toBeNull()

    const res2 = await app.request(`/tasks/${task.id}/reorder`, {
      method: 'PUT', headers: JSON_H1, body: JSON.stringify({ statusId: todoStatus.id, sortOrder: 0 }),
    })
    const body2 = (await res2.json()) as any
    expect(body2.completedAt).toBeNull()
  })

  it('returns 404 when task is not found', async () => {
    const { todoStatus } = await createProjectWithStatuses()
    const res = await app.request('/tasks/nonexistent/reorder', {
      method: 'PUT', headers: JSON_H1, body: JSON.stringify({ statusId: todoStatus.id, sortOrder: 0 }),
    })
    expect(res.status).toBe(404)
  })

  it("returns 404 when statusId doesn't belong to the task's own project", async () => {
    const { project: p1, todoStatus: s1 } = await createProjectWithStatuses('P1')
    const { todoStatus: s2 } = await createProjectWithStatuses('P2')
    const task = (await (
      await post('/tasks', { projectId: p1.id, statusId: s1.id, title: 'X' })
    ).json()) as any
    const res = await app.request(`/tasks/${task.id}/reorder`, {
      method: 'PUT', headers: JSON_H1, body: JSON.stringify({ statusId: s2.id, sortOrder: 0 }),
    })
    expect(res.status).toBe(404)
  })
})

describe('recurring task regeneration (lazy, via GET /tasks)', () => {
  it('archives the template and creates exactly one fresh instance, with no duplicate on a second read', async () => {
    const { project, doneStatus } = await createProjectWithStatuses()
    const yesterday = addDays(new Date().toISOString().slice(0, 10), -1)
    const created = (await (
      await post('/tasks', {
        projectId: project.id,
        statusId: doneStatus.id,
        title: 'Recurring Task',
        dueDate: yesterday,
        recurrenceInterval: 'daily',
        recurrenceCount: 1,
      })
    ).json()) as any

    const firstRead = (await (await get(`/tasks?projectId=${project.id}`)).json()) as any[]
    // Template should be archived (excluded from the list).
    expect(firstRead.find((t) => t.id === created.id)).toBeUndefined()

    const instances = firstRead.filter((t) => t.title === 'Recurring Task')
    expect(instances).toHaveLength(1)
    const instance = instances[0]!
    expect(instance.dueDate).toBe(addDays(yesterday, 1))
    expect(instance.recurrenceInterval).toBeNull()
    expect(instance.archived).toBe(false)
    const projectStatusIds = (await (await get(`/statuses?projectId=${project.id}`)).json() as any[]).map((s) => s.id)
    expect(projectStatusIds).toContain(instance.statusId)

    // Second read shouldn't create a duplicate.
    const secondRead = (await (await get(`/tasks?projectId=${project.id}`)).json()) as any[]
    const instancesAgain = secondRead.filter((t) => t.title === 'Recurring Task')
    expect(instancesAgain).toHaveLength(1)
    expect(instancesAgain[0]!.id).toBe(instance.id)
  })
})
