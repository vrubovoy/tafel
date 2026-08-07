import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { cleanDb, sqlite } from './helpers/db.js'
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

async function createProject(name = 'Project') {
  return (await (await post('/projects', { name })).json()) as any
}

describe('GET /statuses', () => {
  it('returns the project statuses (the 3 auto-created ones)', async () => {
    const project = await createProject()
    const res = await get(`/statuses?projectId=${project.id}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as any[]
    expect(body).toHaveLength(3)
    expect(body.every((s) => s.projectId === project.id)).toBe(true)
  })

  it('returns 400 when projectId query param is omitted', async () => {
    const res = await get('/statuses')
    expect(res.status).toBe(400)
  })

  it('returns 404 when the project does not exist', async () => {
    const res = await get('/statuses?projectId=nonexistent')
    expect(res.status).toBe(404)
  })
})

describe('POST /statuses', () => {
  it('creates a status with defaults and returns 201', async () => {
    const project = await createProject()
    const res = await post('/statuses', { projectId: project.id, name: 'Review' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as any
    expect(body.name).toBe('Review')
    expect(body.projectId).toBe(project.id)
    expect(body.color).toBe('#94a3b8')
    expect(body.sortOrder).toBe(0)
    expect(body.isDone).toBe(false)
  })

  it('creates a status with all fields overridden', async () => {
    const project = await createProject()
    const res = await post('/statuses', {
      projectId: project.id,
      name: 'Archived-ish',
      color: '#ff00ff',
      sortOrder: 9,
      isDone: true,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as any
    expect(body.color).toBe('#ff00ff')
    expect(body.sortOrder).toBe(9)
    expect(body.isDone).toBe(true)
  })

  it('returns 404 when projectId is not owned/found', async () => {
    const res = await post('/statuses', { projectId: 'nonexistent', name: 'X' })
    expect(res.status).toBe(404)
  })

  it('returns 400 when required fields are missing', async () => {
    const project = await createProject()
    const res = await post('/statuses', { projectId: project.id })
    expect(res.status).toBe(400)
  })
})

describe('PUT /statuses/:id', () => {
  it('renames a status', async () => {
    const project = await createProject()
    const statuses = (await (await get(`/statuses?projectId=${project.id}`)).json()) as any[]
    const status = statuses[0]!
    const res = await put(`/statuses/${status.id}`, { name: 'Renamed' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.name).toBe('Renamed')
  })

  it('recolors, reorders, and toggles isDone', async () => {
    const project = await createProject()
    const statuses = (await (await get(`/statuses?projectId=${project.id}`)).json()) as any[]
    const status = statuses.find((s) => s.isDone === false)!
    const res = await put(`/statuses/${status.id}`, { color: '#abcdef', sortOrder: 42, isDone: true })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.color).toBe('#abcdef')
    expect(body.sortOrder).toBe(42)
    expect(body.isDone).toBe(true)
  })

  it('sets and clears completedAt for every task when isDone is toggled', async () => {
    const project = await createProject()
    const statuses = (await (await get(`/statuses?projectId=${project.id}`)).json()) as any[]
    const status = statuses.find((item) => item.isDone === false)!
    const task = (await (
      await post('/tasks', { projectId: project.id, statusId: status.id, title: 'Toggle with column' })
    ).json()) as any
    expect(task.completedAt).toBeNull()

    await put(`/statuses/${status.id}`, { isDone: true })
    let updated = ((await (await get('/tasks')).json()) as any[]).find((item) => item.id === task.id)!
    expect(updated.completedAt).not.toBeNull()

    await put(`/statuses/${status.id}`, { isDone: false })
    updated = ((await (await get('/tasks')).json()) as any[]).find((item) => item.id === task.id)!
    expect(updated.completedAt).toBeNull()
  })

  it('does not rewrite the completion timestamp of an archived historical task when isDone changes', async () => {
    const project = await createProject()
    const statuses = (await (await get(`/statuses?projectId=${project.id}`)).json()) as any[]
    const done = statuses.find((status) => status.isDone)!
    const active = (await (
      await post('/tasks', { projectId: project.id, statusId: done.id, title: 'Active completion' })
    ).json()) as any
    const historical = (await (
      await post('/tasks', { projectId: project.id, statusId: done.id, title: 'Historical completion' })
    ).json()) as any
    await del(`/tasks/${historical.id}`)
    const originalCompletedAt = Date.parse(historical.completedAt)

    const res = await put(`/statuses/${done.id}`, { isDone: false })

    expect(res.status).toBe(200)
    expect(sqlite.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(active.id))
      .toEqual({ completed_at: null })
    expect(sqlite.prepare('SELECT completed_at FROM tasks WHERE id = ?').get(historical.id))
      .toEqual({ completed_at: originalCompletedAt })
  })

  it('returns 404 for an unknown id', async () => {
    const res = await put('/statuses/nonexistent', { name: 'X' })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /statuses/:id', () => {
  it('deletes a status with zero referencing tasks', async () => {
    const project = await createProject()
    const statuses = (await (await get(`/statuses?projectId=${project.id}`)).json()) as any[]
    const status = statuses[0]!
    const res = await del(`/statuses/${status.id}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const remaining = (await (await get(`/statuses?projectId=${project.id}`)).json()) as any[]
    expect(remaining.find((s) => s.id === status.id)).toBeUndefined()
    expect(remaining).toHaveLength(2)
  })

  it('returns 409 and does not delete when tasks reference it and no reassignTo given', async () => {
    const project = await createProject()
    const statuses = (await (await get(`/statuses?projectId=${project.id}`)).json()) as any[]
    const status = statuses[0]!
    await post('/tasks', { projectId: project.id, statusId: status.id, title: 'Blocking task' })

    const res = await del(`/statuses/${status.id}`)
    expect(res.status).toBe(409)

    const remaining = (await (await get(`/statuses?projectId=${project.id}`)).json()) as any[]
    expect(remaining.find((s) => s.id === status.id)).toBeDefined()
  })

  it('requires reassignment for archived references and preserves their historical completion timestamp', async () => {
    const project = await createProject()
    const statuses = (await (await get(`/statuses?projectId=${project.id}`)).json()) as any[]
    const from = statuses.find((status) => status.isDone)!
    const to = statuses.find((status) => !status.isDone)!
    const historical = (await (
      await post('/tasks', { projectId: project.id, statusId: from.id, title: 'Archived reference' })
    ).json()) as any
    await del(`/tasks/${historical.id}`)
    const originalCompletedAt = Date.parse(historical.completedAt)

    const blocked = await del(`/statuses/${from.id}`)
    expect(blocked.status).toBe(409)

    const reassigned = await del(`/statuses/${from.id}?reassignTo=${to.id}`)
    expect(reassigned.status).toBe(200)
    expect(sqlite.prepare(
      'SELECT status_id, completed_at, archived FROM tasks WHERE id = ?',
    ).get(historical.id)).toEqual({
      status_id: to.id,
      completed_at: originalCompletedAt,
      archived: 1,
    })
  })

  it('reassigns referencing tasks and deletes when reassignTo points to a status in the same project', async () => {
    const project = await createProject()
    const statuses = (await (await get(`/statuses?projectId=${project.id}`)).json()) as any[]
    const from = statuses[0]!
    const to = statuses[1]!
    const task = (await (
      await post('/tasks', { projectId: project.id, statusId: from.id, title: 'Reassign me' })
    ).json()) as any

    const res = await del(`/statuses/${from.id}?reassignTo=${to.id}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const remaining = (await (await get(`/statuses?projectId=${project.id}`)).json()) as any[]
    expect(remaining.find((s) => s.id === from.id)).toBeUndefined()

    const tasks = (await (await get('/tasks')).json()) as any[]
    const updated = tasks.find((t) => t.id === task.id)!
    expect(updated.statusId).toBe(to.id)
  })

  it('returns 404 when reassignTo points to a status in a different project', async () => {
    const project1 = await createProject('P1')
    const project2 = await createProject('P2')
    const statuses1 = (await (await get(`/statuses?projectId=${project1.id}`)).json()) as any[]
    const statuses2 = (await (await get(`/statuses?projectId=${project2.id}`)).json()) as any[]
    const from = statuses1[0]!
    const foreignTo = statuses2[0]!
    await post('/tasks', { projectId: project1.id, statusId: from.id, title: 'Task' })

    const res = await del(`/statuses/${from.id}?reassignTo=${foreignTo.id}`)
    expect(res.status).toBe(404)

    const remaining = (await (await get(`/statuses?projectId=${project1.id}`)).json()) as any[]
    expect(remaining.find((s) => s.id === from.id)).toBeDefined()
  })

  it('returns 404 when reassignTo points to a nonexistent status', async () => {
    const project = await createProject()
    const statuses = (await (await get(`/statuses?projectId=${project.id}`)).json()) as any[]
    const from = statuses[0]!
    await post('/tasks', { projectId: project.id, statusId: from.id, title: 'Task' })

    const res = await del(`/statuses/${from.id}?reassignTo=nonexistent`)
    expect(res.status).toBe(404)
  })

  it('returns 404 for an unknown status id', async () => {
    const res = await del('/statuses/nonexistent')
    expect(res.status).toBe(404)
  })
})
