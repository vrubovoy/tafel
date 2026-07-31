import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mock the db and auth modules before any imports that use them ───
vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()

// ── Typed request helpers ──────────────────────────────────────────
const H1 = { Authorization: 'Bearer test-token' }
const JSON_H1 = { ...H1, 'Content-Type': 'application/json' }

const get = (path: string, headers = H1) => app.request(path, { headers })
const post = (path: string, body: unknown, headers = JSON_H1) =>
  app.request(path, { method: 'POST', headers, body: JSON.stringify(body) })
const put = (path: string, body: unknown, headers = JSON_H1) =>
  app.request(path, { method: 'PUT', headers, body: JSON.stringify(body) })
const del = (path: string, headers = H1) => app.request(path, { method: 'DELETE', headers })

beforeEach(() => cleanDb())

describe('GET /projects', () => {
  it('returns empty array when no projects', async () => {
    const res = await get('/projects')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  it('returns own non-archived projects with expected shape', async () => {
    await post('/projects', { name: 'Work' })
    const res = await get('/projects')
    expect(res.status).toBe(200)
    const body = (await res.json()) as any[]
    expect(body).toHaveLength(1)
    const p = body[0]!
    expect(p.name).toBe('Work')
    expect(p.userId).toBe('user-1')
    expect(p).toHaveProperty('id')
    expect(p).toHaveProperty('color')
    expect(p).toHaveProperty('icon')
    expect(p).toHaveProperty('sortOrder')
    expect(p).toHaveProperty('archived')
    expect(p).toHaveProperty('createdAt')
    expect(p.archived).toBe(false)
  })
})

describe('POST /projects', () => {
  it('creates a project with defaults and returns 201', async () => {
    const res = await post('/projects', { name: 'My Project' })
    expect(res.status).toBe(201)
    const body = (await res.json()) as any
    expect(body.id).toBeTruthy()
    expect(body.name).toBe('My Project')
    expect(body.color).toBe('#f59e0b')
    expect(body.icon).toBe('folder')
    expect(body.sortOrder).toBe(0)
    expect(body.archived).toBe(false)
    expect(body.userId).toBe('user-1')
  })

  it('creates a project with all fields overridden', async () => {
    const res = await post('/projects', {
      name: 'Custom',
      color: '#123456',
      icon: 'star',
      sortOrder: 5,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as any
    expect(body.color).toBe('#123456')
    expect(body.icon).toBe('star')
    expect(body.sortOrder).toBe(5)
  })

  it('returns 400 when name is missing', async () => {
    const res = await post('/projects', {})
    expect(res.status).toBe(400)
  })

  it('returns 400 when name is empty string', async () => {
    const res = await post('/projects', { name: '' })
    expect(res.status).toBe(400)
  })

  it('creates exactly 3 statuses for the project, with one isDone at the highest sortOrder', async () => {
    const project = (await (await post('/projects', { name: 'StatusCheck' })).json()) as any
    const res = await get(`/statuses?projectId=${project.id}`)
    expect(res.status).toBe(200)
    const statuses = (await res.json()) as any[]
    expect(statuses).toHaveLength(3)
    for (const s of statuses) {
      expect(s).toHaveProperty('id')
      expect(s.projectId).toBe(project.id)
      expect(s).toHaveProperty('name')
      expect(s).toHaveProperty('color')
      expect(s).toHaveProperty('sortOrder')
      expect(s).toHaveProperty('isDone')
    }
    const doneStatuses = statuses.filter((s) => s.isDone === true)
    const notDoneStatuses = statuses.filter((s) => s.isDone === false)
    expect(doneStatuses).toHaveLength(1)
    expect(notDoneStatuses).toHaveLength(2)
    const maxOtherSortOrder = Math.max(...notDoneStatuses.map((s) => s.sortOrder))
    expect(doneStatuses[0]!.sortOrder).toBeGreaterThan(maxOtherSortOrder)
  })
})

describe('PUT /projects/:id', () => {
  // SUSPECTED BUG (see test report): this asserts the spec's documented
  // partial-update/merge semantics. As observed, the live API currently
  // resets omitted fields (e.g. color) back to the POST-schema default
  // instead of preserving the existing value, so this test currently fails.
  it('updates a project with a partial body and returns merged fields', async () => {
    const created = (await (await post('/projects', { name: 'Old', color: '#111111' })).json()) as any
    const res = await put(`/projects/${created.id}`, { name: 'New' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.name).toBe('New')
    expect(body.color).toBe('#111111')
    expect(body.id).toBe(created.id)
  })

  it('returns 404 for an unknown id', async () => {
    const res = await put('/projects/nonexistent', { name: 'X' })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /projects/:id', () => {
  it('archives the project so it disappears from GET /projects', async () => {
    const project = (await (await post('/projects', { name: 'ToDelete' })).json()) as any
    const res = await del(`/projects/${project.id}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const list = (await (await get('/projects')).json()) as any[]
    expect(list.find((p) => p.id === project.id)).toBeUndefined()
  })

  it('also archives every task belonging to the project', async () => {
    const project = (await (await post('/projects', { name: 'WithTasks' })).json()) as any
    const statuses = (await (await get(`/statuses?projectId=${project.id}`)).json()) as any[]
    const status = statuses[0]!
    await post('/tasks', { projectId: project.id, statusId: status.id, title: 'A task' })

    await del(`/projects/${project.id}`)

    const tasks = (await (await get(`/tasks?projectId=${project.id}`)).json()) as any[]
    expect(tasks).toEqual([])
  })

  it('returns 404 for an unknown id', async () => {
    const res = await del('/projects/nonexistent')
    expect(res.status).toBe(404)
  })
})

describe('POST /projects/:id/restore', () => {
  it('un-archives the project so it reappears in GET /projects', async () => {
    const project = (await (await post('/projects', { name: 'ToRestore' })).json()) as any
    await del(`/projects/${project.id}`)

    const res = await app.request(`/projects/${project.id}/restore`, { method: 'POST', headers: H1 })
    expect(res.status).toBe(200)

    const list = (await (await get('/projects')).json()) as any[]
    expect(list.find((p) => p.id === project.id)).toBeDefined()
  })

  it('does not un-archive tasks that were archived by the project delete', async () => {
    const project = (await (await post('/projects', { name: 'RestoreButTasksStay' })).json()) as any
    const statuses = (await (await get(`/statuses?projectId=${project.id}`)).json()) as any[]
    const status = statuses[0]!
    await post('/tasks', { projectId: project.id, statusId: status.id, title: 'Stays archived' })

    await del(`/projects/${project.id}`)
    await app.request(`/projects/${project.id}/restore`, { method: 'POST', headers: H1 })

    const tasks = (await (await get(`/tasks?projectId=${project.id}`)).json()) as any[]
    expect(tasks).toEqual([])
  })

  it('returns 404 for an unknown id', async () => {
    const res = await app.request('/projects/nonexistent/restore', { method: 'POST', headers: H1 })
    expect(res.status).toBe(404)
  })
})
