/**
 * Cross-user isolation tests, plus the cross-project-parent 422 case for
 * POST /tasks (cycle-prevention for PUT /tasks/:id lives in tasks.test.ts).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()

const H1 = { Authorization: 'Bearer test-token' }
const H2 = { Authorization: 'Bearer user2-token' }
const JSON_H1 = { ...H1, 'Content-Type': 'application/json' }
const JSON_H2 = { ...H2, 'Content-Type': 'application/json' }

const asUser1 = {
  get: (path: string) => app.request(path, { headers: H1 }),
  post: (path: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: JSON_H1, body: JSON.stringify(body) }),
  put: (path: string, body: unknown) =>
    app.request(path, { method: 'PUT', headers: JSON_H1, body: JSON.stringify(body) }),
  del: (path: string) => app.request(path, { method: 'DELETE', headers: H1 }),
}

const asUser2 = {
  get: (path: string) => app.request(path, { headers: H2 }),
  post: (path: string, body: unknown) =>
    app.request(path, { method: 'POST', headers: JSON_H2, body: JSON.stringify(body) }),
  put: (path: string, body: unknown) =>
    app.request(path, { method: 'PUT', headers: JSON_H2, body: JSON.stringify(body) }),
  del: (path: string) => app.request(path, { method: 'DELETE', headers: H2 }),
}

beforeEach(() => cleanDb())

async function createProjectWithStatuses(owner: typeof asUser1, name = 'Project') {
  const project = (await (await owner.post('/projects', { name })).json()) as any
  const statuses = (await (await owner.get(`/statuses?projectId=${project.id}`)).json()) as any[]
  const doneStatus = statuses.find((s: any) => s.isDone === true)!
  const todoStatus = statuses.find((s: any) => s.isDone === false)!
  return { project, doneStatus, todoStatus }
}

// ── Projects ───────────────────────────────────────────────────────
describe('Project isolation', () => {
  it('user-2 sees an empty project list even when user-1 has projects', async () => {
    await asUser1.post('/projects', { name: 'Secret Project' })
    const list = (await (await asUser2.get('/projects')).json()) as any[]
    expect(list).toHaveLength(0)
  })

  it('user-2 cannot update user-1 project', async () => {
    const project = (await (await asUser1.post('/projects', { name: 'A' })).json()) as any
    expect((await asUser2.put(`/projects/${project.id}`, { name: 'Hijacked' })).status).toBe(404)
  })

  it('user-2 cannot delete user-1 project', async () => {
    const project = (await (await asUser1.post('/projects', { name: 'A' })).json()) as any
    expect((await asUser2.del(`/projects/${project.id}`)).status).toBe(404)
  })

  it('user-2 cannot restore user-1 archived project', async () => {
    const project = (await (await asUser1.post('/projects', { name: 'A' })).json()) as any
    await asUser1.del(`/projects/${project.id}`)
    const res = await app.request(`/projects/${project.id}/restore`, { method: 'POST', headers: H2 })
    expect(res.status).toBe(404)
  })
})

// ── Statuses ───────────────────────────────────────────────────────
describe('Status isolation', () => {
  it("user-2 gets 404 listing statuses of user-1's project (ownership check runs first)", async () => {
    const { project } = await createProjectWithStatuses(asUser1)
    const res = await asUser2.get(`/statuses?projectId=${project.id}`)
    expect(res.status).toBe(404)
  })

  it('user-2 cannot update a status belonging to user-1', async () => {
    const { todoStatus } = await createProjectWithStatuses(asUser1)
    const res = await asUser2.put(`/statuses/${todoStatus.id}`, { name: 'Hijacked' })
    expect(res.status).toBe(404)
  })

  it('user-2 cannot delete a status belonging to user-1', async () => {
    const { todoStatus } = await createProjectWithStatuses(asUser1)
    const res = await asUser2.del(`/statuses/${todoStatus.id}`)
    expect(res.status).toBe(404)
  })

  it("user-2 cannot create a status under user-1's project", async () => {
    const { project } = await createProjectWithStatuses(asUser1)
    const res = await asUser2.post('/statuses', { projectId: project.id, name: 'Intrusion' })
    expect(res.status).toBe(404)
  })
})

// ── Tasks ──────────────────────────────────────────────────────────
describe('Task isolation', () => {
  it('user-2 sees an empty task list even when user-1 has tasks', async () => {
    const { project, todoStatus } = await createProjectWithStatuses(asUser1)
    await asUser1.post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Secret' })
    const list = (await (await asUser2.get('/tasks')).json()) as any[]
    expect(list).toHaveLength(0)
  })

  it('user-2 cannot update a task belonging to user-1', async () => {
    const { project, todoStatus } = await createProjectWithStatuses(asUser1)
    const task = (await (
      await asUser1.post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'X' })
    ).json()) as any
    const res = await asUser2.put(`/tasks/${task.id}`, { title: 'Hijacked' })
    expect(res.status).toBe(404)
  })

  it('user-2 cannot delete a task belonging to user-1', async () => {
    const { project, todoStatus } = await createProjectWithStatuses(asUser1)
    const task = (await (
      await asUser1.post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'X' })
    ).json()) as any
    const res = await asUser2.del(`/tasks/${task.id}`)
    expect(res.status).toBe(404)
  })

  it('user-2 cannot reorder a task belonging to user-1', async () => {
    const { project, todoStatus } = await createProjectWithStatuses(asUser1)
    const task = (await (
      await asUser1.post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'X' })
    ).json()) as any
    const res = await app.request(`/tasks/${task.id}/reorder`, {
      method: 'PUT', headers: JSON_H2, body: JSON.stringify({ statusId: todoStatus.id, sortOrder: 1 }),
    })
    expect(res.status).toBe(404)
  })

  it("user-2 creating a task under their OWN project cannot point statusId at user-1's status", async () => {
    const { todoStatus: user1Status } = await createProjectWithStatuses(asUser1)
    const own = await createProjectWithStatuses(asUser2, 'User2 project')
    const res = await asUser2.post('/tasks', {
      projectId: own.project.id, statusId: user1Status.id, title: 'Cross-reference attempt',
    })
    expect(res.status).toBe(404)
  })

  it("user-2 creating a task under their OWN project cannot point parentTaskId at user-1's task", async () => {
    const { project: p1, todoStatus: s1 } = await createProjectWithStatuses(asUser1)
    const user1Task = (await (
      await asUser1.post('/tasks', { projectId: p1.id, statusId: s1.id, title: 'User1 task' })
    ).json()) as any
    const own = await createProjectWithStatuses(asUser2, 'User2 project')
    const res = await asUser2.post('/tasks', {
      projectId: own.project.id, statusId: own.todoStatus.id, title: 'X', parentTaskId: user1Task.id,
    })
    expect(res.status).toBe(404)
  })
})

// ── Cross-project parent (422) ────────────────────────────────────
describe('POST /tasks cross-project parent', () => {
  it('returns 422 when parentTaskId belongs to a different project than projectId (same owner)', async () => {
    const { project: p1, todoStatus: s1 } = await createProjectWithStatuses(asUser1, 'P1')
    const { project: p2, todoStatus: s2 } = await createProjectWithStatuses(asUser1, 'P2')
    const parentInP1 = (await (
      await asUser1.post('/tasks', { projectId: p1.id, statusId: s1.id, title: 'Parent in P1' })
    ).json()) as any

    const res = await asUser1.post('/tasks', {
      projectId: p2.id, statusId: s2.id, title: 'Child in P2', parentTaskId: parentInP1.id,
    })
    expect(res.status).toBe(422)
  })
})
