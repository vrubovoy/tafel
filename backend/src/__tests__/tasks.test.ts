import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

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
afterEach(() => vi.useRealTimers())

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
      'recurrenceCount', 'recurrenceAnchorDate', 'recurrenceSeriesId',
      'archived', 'archivedByProject', 'createdAt',
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

  it('never leaves a task with a status or parent from its old project after a cross-project move', async () => {
    const { project: p1, todoStatus: s1 } = await createProjectWithStatuses('P1')
    const { project: p2 } = await createProjectWithStatuses('P2')
    const parent = (await (
      await post('/tasks', { projectId: p1.id, statusId: s1.id, title: 'Parent' })
    ).json()) as any
    const child = (await (
      await post('/tasks', {
        projectId: p1.id, statusId: s1.id, title: 'Child', parentTaskId: parent.id,
      })
    ).json()) as any

    const moveResponse = await put(`/tasks/${child.id}`, { projectId: p2.id })
    expect(moveResponse.status).toBeLessThan(500)

    const tasks = (await (await get('/tasks')).json()) as any[]
    const updated = tasks.find((task) => task.id === child.id)!
    if (updated.projectId === p2.id) {
      const p2Statuses = (await (await get(`/statuses?projectId=${p2.id}`)).json()) as any[]
      expect(p2Statuses.map((status) => status.id)).toContain(updated.statusId)
      if (updated.parentTaskId !== null) {
        expect(tasks.find((task) => task.id === updated.parentTaskId)?.projectId).toBe(p2.id)
      }
    } else {
      expect(updated).toMatchObject({ projectId: p1.id, statusId: s1.id, parentTaskId: parent.id })
    }
  })

  it('rejects moving a task into an archived project without changing the task', async () => {
    const { project: source, todoStatus } = await createProjectWithStatuses('Source')
    const { project: destination } = await createProjectWithStatuses('Archived destination')
    const task = (await (
      await post('/tasks', { projectId: source.id, statusId: todoStatus.id, title: 'Stay put' })
    ).json()) as any
    await del(`/projects/${destination.id}`)

    const moveResponse = await put(`/tasks/${task.id}`, { projectId: destination.id })

    expect(moveResponse.status).toBe(409)
    const tasks = (await (await get(`/tasks?projectId=${source.id}`)).json()) as any[]
    expect(tasks.find((candidate) => candidate.id === task.id)).toMatchObject({
      projectId: source.id,
      statusId: todoStatus.id,
    })
  })

  it('rejects moving a task out of an archived project or clears its project-archive flags', async () => {
    const { project: source, todoStatus } = await createProjectWithStatuses('Archived source')
    const { project: destination } = await createProjectWithStatuses('Active destination')
    const task = (await (
      await post('/tasks', { projectId: source.id, statusId: todoStatus.id, title: 'Move safely' })
    ).json()) as any
    await del(`/projects/${source.id}`)

    const moveResponse = await put(`/tasks/${task.id}`, { projectId: destination.id })

    expect(moveResponse.status).toBeLessThan(500)
    if (moveResponse.ok) {
      expect(await moveResponse.json()).toMatchObject({
        projectId: destination.id,
        archived: false,
        archivedByProject: false,
      })
      const destinationTasks = (await (await get(`/tasks?projectId=${destination.id}`)).json()) as any[]
      expect(destinationTasks.find((candidate) => candidate.id === task.id)).toMatchObject({
        archived: false,
        archivedByProject: false,
      })
    } else {
      expect(moveResponse.status).toBeGreaterThanOrEqual(400)
      await app.request(`/projects/${source.id}/restore`, { method: 'POST', headers: H1 })
      const sourceTasks = (await (await get(`/tasks?projectId=${source.id}`)).json()) as any[]
      expect(sourceTasks.find((candidate) => candidate.id === task.id)).toMatchObject({
        projectId: source.id,
      })
    }
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

describe('POST /tasks/:id/restore', () => {
  it('does not expose a restored nested task beneath archived ancestors', async () => {
    const { project, todoStatus } = await createProjectWithStatuses()
    const parent = (await (
      await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Parent' })
    ).json()) as any
    const child = (await (
      await post('/tasks', {
        projectId: project.id,
        statusId: todoStatus.id,
        title: 'Child',
        parentTaskId: parent.id,
      })
    ).json()) as any
    const grandchild = (await (
      await post('/tasks', {
        projectId: project.id,
        statusId: todoStatus.id,
        title: 'Grandchild',
        parentTaskId: child.id,
      })
    ).json()) as any
    await del(`/tasks/${parent.id}`)

    const restoreResponse = await app.request(`/tasks/${grandchild.id}/restore`, {
      method: 'POST',
      headers: H1,
    })
    expect(restoreResponse.status).toBe(409)

    const visible = (await (await get(`/tasks?projectId=${project.id}`)).json()) as any[]
    expect(visible).toEqual([])
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
    expect(instance.recurrenceInterval).toBe('daily')
    expect(instance.recurrenceCount).toBe(1)
    expect(instance.recurrenceSeriesId).toBe(created.recurrenceSeriesId)
    expect(instance.archived).toBe(false)
    const projectStatusIds = (await (await get(`/statuses?projectId=${project.id}`)).json() as any[]).map((s) => s.id)
    expect(projectStatusIds).toContain(instance.statusId)

    // Second read shouldn't create a duplicate.
    const secondRead = (await (await get(`/tasks?projectId=${project.id}`)).json()) as any[]
    const instancesAgain = secondRead.filter((t) => t.title === 'Recurring Task')
    expect(instancesAgain).toHaveLength(1)
    expect(instancesAgain[0]!.id).toBe(instance.id)
  })

  it('keeps recurrence on successors so the task regenerates after multiple completions', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-03T12:00:00.000Z'))
    const { project, doneStatus } = await createProjectWithStatuses()
    await post('/tasks', {
      projectId: project.id,
      statusId: doneStatus.id,
      title: 'Daily forever',
      dueDate: '2026-01-01',
      recurrenceInterval: 'daily',
      recurrenceCount: 1,
    })

    const afterFirstCompletion = (await (await get(`/tasks?projectId=${project.id}`)).json()) as any[]
    const firstSuccessor = afterFirstCompletion.find((task) => task.title === 'Daily forever')!
    expect(firstSuccessor.dueDate).toBe('2026-01-02')

    await put(`/tasks/${firstSuccessor.id}`, { statusId: doneStatus.id })
    const afterSecondCompletion = (await (await get(`/tasks?projectId=${project.id}`)).json()) as any[]
    const secondSuccessor = afterSecondCompletion.find((task) => task.title === 'Daily forever')!

    expect(secondSuccessor.id).not.toBe(firstSuccessor.id)
    expect(secondSuccessor).toMatchObject({
      dueDate: '2026-01-03',
      recurrenceInterval: 'daily',
      recurrenceCount: 1,
      recurrenceAnchorDate: '2026-01-03',
      completedAt: null,
      archived: false,
    })
  })

  it('keeps a recurring successor attached to the template parent', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-03T12:00:00.000Z'))
    const { project, todoStatus, doneStatus } = await createProjectWithStatuses()
    const parent = (await (
      await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Parent' })
    ).json()) as any
    await post('/tasks', {
      projectId: project.id,
      statusId: doneStatus.id,
      parentTaskId: parent.id,
      title: 'Recurring child',
      dueDate: '2026-01-01',
      recurrenceInterval: 'daily',
      recurrenceCount: 1,
    })

    const tasks = (await (await get(`/tasks?projectId=${project.id}`)).json()) as any[]
    const successor = tasks.find((task) => task.title === 'Recurring child')!

    expect(successor.parentTaskId).toBe(parent.id)
  })

  it('does not fork the chain when a historical recurring instance is restored', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-03T12:00:00.000Z'))
    const { project, doneStatus } = await createProjectWithStatuses()
    const historical = (await (
      await post('/tasks', {
        projectId: project.id,
        statusId: doneStatus.id,
        title: 'One chain',
        dueDate: '2026-01-01',
        recurrenceInterval: 'daily',
        recurrenceCount: 1,
      })
    ).json()) as any

    await get(`/tasks?projectId=${project.id}`)
    const restoreResponse = await app.request(`/tasks/${historical.id}/restore`, {
      method: 'POST',
      headers: H1,
    })
    expect(restoreResponse.status).toBe(409)

    const tasks = (await (await get(`/tasks?projectId=${project.id}`)).json()) as any[]
    const activeChain = tasks.filter(
      (task) => task.title === 'One chain' && task.recurrenceInterval !== null,
    )
    expect(activeChain).toHaveLength(1)
    expect(activeChain[0]!.dueDate).toBe('2026-01-02')
  })

  it('allows restore when only an unrelated recurring series has a later occurrence', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-03T12:00:00.000Z'))
    const { project, doneStatus } = await createProjectWithStatuses()
    const historical = (await (
      await post('/tasks', {
        projectId: project.id,
        statusId: doneStatus.id,
        title: 'Series to restore',
        dueDate: '2026-01-01',
        recurrenceInterval: 'daily',
        recurrenceCount: 1,
      })
    ).json()) as any
    await del(`/tasks/${historical.id}`)
    await post('/tasks', {
      projectId: project.id,
      statusId: doneStatus.id,
      title: 'Unrelated series',
      dueDate: '2026-01-01',
      recurrenceInterval: 'daily',
      recurrenceCount: 1,
    })
    await get(`/tasks?projectId=${project.id}`)

    const restoreResponse = await app.request(`/tasks/${historical.id}/restore`, {
      method: 'POST',
      headers: H1,
    })

    expect(restoreResponse.status).toBe(200)
    expect(await restoreResponse.json()).toMatchObject({ id: historical.id, archived: false })
  })

  it('does not restore historical occurrences while restoring their parent subtree', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-03T12:00:00.000Z'))
    const { project, todoStatus, doneStatus } = await createProjectWithStatuses()
    const parent = (await (
      await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Parent' })
    ).json()) as any
    await post('/tasks', {
      projectId: project.id,
      statusId: doneStatus.id,
      parentTaskId: parent.id,
      title: 'Recurring child chain',
      dueDate: '2026-01-01',
      recurrenceInterval: 'daily',
      recurrenceCount: 1,
    })
    await get(`/tasks?projectId=${project.id}`)
    await del(`/tasks/${parent.id}`)

    const restoreResponse = await app.request(`/tasks/${parent.id}/restore`, {
      method: 'POST',
      headers: H1,
    })
    expect(restoreResponse.status).toBe(200)

    const visible = (await (await get(`/tasks?projectId=${project.id}`)).json()) as any[]
    const activeChain = visible.filter((task) => task.title === 'Recurring child chain')
    expect(activeChain).toHaveLength(1)
    expect(activeChain[0]!.dueDate).toBe('2026-01-02')
    expect(activeChain[0]!.parentTaskId).toBe(parent.id)
  })
})
