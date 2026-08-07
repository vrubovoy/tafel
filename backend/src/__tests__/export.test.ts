import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()
const H1 = { Authorization: 'Bearer test-token' }
const H2 = { Authorization: 'Bearer user2-token' }
const jsonHeaders = (headers: Record<string, string>) => ({ ...headers, 'Content-Type': 'application/json' })
const get = (path: string, headers = H1) => app.request(path, { headers })
const post = (path: string, body: unknown, headers = H1) =>
  app.request(path, { method: 'POST', headers: jsonHeaders(headers), body: JSON.stringify(body) })
const del = (path: string, headers = H1) => app.request(path, { method: 'DELETE', headers })

beforeEach(() => cleanDb())

describe('GET /users/export', () => {
  it('exports all and only the caller-owned projects, statuses, and tasks, including archived data', async () => {
    const activeProject = (await (await post('/projects', { name: 'Mine active' })).json()) as any
    const activeStatuses = (await (await get(`/statuses?projectId=${activeProject.id}`)).json()) as any[]
    const activeTask = (await (
      await post('/tasks', {
        projectId: activeProject.id, statusId: activeStatuses[0]!.id, title: 'Mine active task',
      })
    ).json()) as any

    const archivedProject = (await (await post('/projects', { name: 'Mine archived' })).json()) as any
    const archivedStatuses = (await (await get(`/statuses?projectId=${archivedProject.id}`)).json()) as any[]
    const archivedTask = (await (
      await post('/tasks', {
        projectId: archivedProject.id, statusId: archivedStatuses[0]!.id, title: 'Mine archived task',
      })
    ).json()) as any
    await del(`/projects/${archivedProject.id}`)

    const otherProject = (await (await post('/projects', { name: 'Theirs' }, H2)).json()) as any
    const otherStatuses = (await (await get(`/statuses?projectId=${otherProject.id}`, H2)).json()) as any[]
    const otherTask = (await (
      await post('/tasks', {
        projectId: otherProject.id, statusId: otherStatuses[0]!.id, title: 'Their task',
      }, H2)
    ).json()) as any

    const res = await get('/users/export')
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.scope).toBe('tafel-account-only')
    expect(Number.isNaN(new Date(body.exportedAt).getTime())).toBe(false)
    expect(body.projects.map((project: any) => project.id).sort()).toEqual(
      [activeProject.id, archivedProject.id].sort(),
    )
    expect(body.statuses.map((status: any) => status.id).sort()).toEqual(
      [...activeStatuses, ...archivedStatuses].map((status) => status.id).sort(),
    )
    expect(body.tasks.map((task: any) => task.id).sort()).toEqual([activeTask.id, archivedTask.id].sort())
    expect(body.projects.find((project: any) => project.id === archivedProject.id)?.archived).toBe(true)
    expect(body.tasks.find((task: any) => task.id === archivedTask.id)?.archived).toBe(true)
    expect(body.projects.map((project: any) => project.id)).not.toContain(otherProject.id)
    expect(body.statuses.map((status: any) => status.id)).not.toContain(otherStatuses[0]!.id)
    expect(body.tasks.map((task: any) => task.id)).not.toContain(otherTask.id)
  })
})
