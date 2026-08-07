import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { cleanDb, db, sqlite } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()
const H1 = { Authorization: 'Bearer test-token' }
const H2 = { Authorization: 'Bearer user2-token' }
const DELEGATED_H1 = { Authorization: 'Bearer tafel-export-user1-token' }
const WRONG_SERVICE_DELEGATION = { Authorization: 'Bearer kuvert-export-user1-token' }
const WRONG_SCOPE_DELEGATION = { Authorization: 'Bearer tafel-read-user1-token' }
const WRONG_TOKEN_USE_DELEGATION = { Authorization: 'Bearer tafel-access-user1-token' }
const jsonHeaders = (headers: Record<string, string>) => ({ ...headers, 'Content-Type': 'application/json' })
const get = (path: string, headers = H1) => app.request(path, { headers })
const post = (path: string, body: unknown, headers = H1) =>
  app.request(path, { method: 'POST', headers: jsonHeaders(headers), body: JSON.stringify(body) })
const del = (path: string, headers = H1) => app.request(path, { method: 'DELETE', headers })

function expectPrivateExportHeaders(response: Response) {
  expect(response.headers.get('Cache-Control')).toContain('no-store')
  expect(response.headers.get('Cache-Control')).toContain('private')
  expect(response.headers.get('Pragma')).toBe('no-cache')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
}

beforeEach(() => {
  cleanDb()
  sqlite.exec('UPDATE users SET week_starts_on = NULL')
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('GET /users/export', () => {
  it('retains the legacy account-only endpoint and response shape', async () => {
    const activeProject = (await (await post('/projects', { name: 'Mine active' })).json()) as any
    const activeStatuses = (await (await get(`/statuses?projectId=${activeProject.id}`)).json()) as any[]
    const activeTask = (await (await post('/tasks', {
      projectId: activeProject.id,
      statusId: activeStatuses[0]!.id,
      title: 'Mine active task',
    })).json()) as any

    const archivedProject = (await (await post('/projects', { name: 'Mine archived' })).json()) as any
    const archivedStatuses = (await (await get(`/statuses?projectId=${archivedProject.id}`)).json()) as any[]
    const archivedTask = (await (await post('/tasks', {
      projectId: archivedProject.id,
      statusId: archivedStatuses[0]!.id,
      title: 'Mine archived task',
    })).json()) as any
    await del(`/projects/${archivedProject.id}`)

    const otherProject = (await (await post('/projects', { name: 'Theirs' }, H2)).json()) as any
    const otherStatuses = (await (await get(`/statuses?projectId=${otherProject.id}`, H2)).json()) as any[]
    const otherTask = (await (await post('/tasks', {
      projectId: otherProject.id,
      statusId: otherStatuses[0]!.id,
      title: 'Their task',
    }, H2)).json()) as any

    const res = await get('/users/export')

    expect(res.status).toBe(200)
    expectPrivateExportHeaders(res)
    const body = (await res.json()) as any
    expect(body.scope).toBe('tafel-account-only')
    expect(new Date(body.exportedAt).toISOString()).toBe(body.exportedAt)
    expect(body.projects.map((row: any) => row.id).sort()).toEqual(
      [activeProject.id, archivedProject.id].sort(),
    )
    expect(body.statuses.map((row: any) => row.id).sort()).toEqual(
      [...activeStatuses, ...archivedStatuses].map((row) => row.id).sort(),
    )
    expect(body.tasks.map((row: any) => row.id).sort()).toEqual([activeTask.id, archivedTask.id].sort())
    expect(body.projects.find((row: any) => row.id === archivedProject.id)).toMatchObject({ archived: true })
    expect(body.tasks.find((row: any) => row.id === archivedTask.id)).toMatchObject({ archived: true })
    expect(body.projects.map((row: any) => row.id)).not.toContain(otherProject.id)
    expect(body.statuses.map((row: any) => row.id)).not.toContain(otherStatuses[0]!.id)
    expect(body.tasks.map((row: any) => row.id)).not.toContain(otherTask.id)
    expect(body).not.toHaveProperty('version')
    expect(body).not.toHaveProperty('data')
  })
})

describe('GET /exports/me', () => {
  it('returns the standardized v1 Tafel envelope through the access exportPrincipal', async () => {
    const res = await get('/exports/me')

    expect(res.status).toBe(200)
    expectPrivateExportHeaders(res)
    const body = (await res.json()) as any
    expect(body).toEqual({
      version: '1',
      service: 'tafel',
      exportedAt: expect.any(String),
      data: {
        weekStartsOn: null,
        projects: [],
        statuses: [],
        tasks: [],
      },
    })
    expect(new Date(body.exportedAt).toISOString()).toBe(body.exportedAt)
  })

  it('accepts a Tafel-scoped export delegation without granting ordinary API access', async () => {
    const exportRes = await get('/exports/me', DELEGATED_H1)
    expect(exportRes.status).toBe(200)
    expectPrivateExportHeaders(exportRes)
    expect(await exportRes.json()).toMatchObject({ version: '1', service: 'tafel' })

    const ordinaryRes = await get('/projects', DELEGATED_H1)
    expect(ordinaryRes.status).toBe(401)
  })

  it.each([
    ['another service audience', WRONG_SERVICE_DELEGATION],
    ['no exact data:export scope', WRONG_SCOPE_DELEGATION],
    ['a token_use other than export', WRONG_TOKEN_USE_DELEGATION],
  ])('rejects delegated auth with %s', async (_case, headers) => {
    const res = await get('/exports/me', headers)
    expect(res.status).toBe(401)
  })

  it('reads one complete owner-scoped snapshot including the local override, archives, and recurrence history', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-07T12:00:00.000Z'))
    await app.request('/users/me', {
      method: 'PUT',
      headers: jsonHeaders(H1),
      body: JSON.stringify({ weekStartsOn: 0 }),
    })

    const activeProject = (await (await post('/projects', { name: 'Mine active' })).json()) as any
    const activeStatuses = (await (await get(`/statuses?projectId=${activeProject.id}`)).json()) as any[]
    const todoStatus = activeStatuses.find((status) => !status.isDone)!
    const doneStatus = activeStatuses.find((status) => status.isDone)!
    const activeTask = (await (await post('/tasks', {
      projectId: activeProject.id,
      statusId: todoStatus.id,
      title: 'Mine active task',
    })).json()) as any
    const historicalOccurrence = (await (await post('/tasks', {
      projectId: activeProject.id,
      statusId: doneStatus.id,
      title: 'Recurring history',
      dueDate: '2026-08-06',
      recurrenceInterval: 'daily',
      recurrenceCount: 1,
    })).json()) as any
    const visibleTasks = (await (await get(`/tasks?projectId=${activeProject.id}`)).json()) as any[]
    const currentOccurrence = visibleTasks.find((task) => task.title === 'Recurring history')!

    const archivedProject = (await (await post('/projects', { name: 'Mine archived' })).json()) as any
    const archivedStatuses = (await (await get(`/statuses?projectId=${archivedProject.id}`)).json()) as any[]
    const archivedTask = (await (await post('/tasks', {
      projectId: archivedProject.id,
      statusId: archivedStatuses[0]!.id,
      title: 'Mine archived task',
    })).json()) as any
    await del(`/projects/${archivedProject.id}`)

    const otherProject = (await (await post('/projects', { name: 'Theirs' }, H2)).json()) as any
    const otherStatuses = (await (await get(`/statuses?projectId=${otherProject.id}`, H2)).json()) as any[]
    const otherTask = (await (await post('/tasks', {
      projectId: otherProject.id,
      statusId: otherStatuses[0]!.id,
      title: 'Their task',
    }, H2)).json()) as any

    const transaction = vi.spyOn(db, 'transaction')
    const readTransactionStates: boolean[] = []
    const prepare = sqlite.prepare.bind(sqlite)
    const prepareSpy = vi.spyOn(sqlite, 'prepare').mockImplementation(((source: string) => {
      if (/\bfrom\s+[`"]?(users|projects|statuses|tasks)[`"]?/i.test(source)) {
        readTransactionStates.push(sqlite.inTransaction)
      }
      return prepare(source)
    }) as typeof sqlite.prepare)

    let res: Response
    try {
      res = await get('/exports/me')
    } finally {
      prepareSpy.mockRestore()
    }

    expect(res.status).toBe(200)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(readTransactionStates.length).toBeGreaterThanOrEqual(4)
    expect(readTransactionStates.every(Boolean)).toBe(true)
    const body = (await res.json()) as any
    const snapshot = body.data
    expect(snapshot.weekStartsOn).toBe(0)
    expect(snapshot.projects.map((row: any) => row.id).sort()).toEqual(
      [activeProject.id, archivedProject.id].sort(),
    )
    expect(snapshot.statuses.map((row: any) => row.id).sort()).toEqual(
      [...activeStatuses, ...archivedStatuses].map((row) => row.id).sort(),
    )
    expect(snapshot.tasks.map((row: any) => row.id).sort()).toEqual(
      [activeTask.id, historicalOccurrence.id, currentOccurrence.id, archivedTask.id].sort(),
    )
    expect(snapshot.projects.find((row: any) => row.id === archivedProject.id)).toMatchObject({ archived: true })
    expect(snapshot.tasks.find((row: any) => row.id === archivedTask.id)).toMatchObject({
      archived: true,
      archivedByProject: true,
    })
    expect(snapshot.tasks.find((row: any) => row.id === historicalOccurrence.id)).toMatchObject({
      archived: true,
      recurrenceInterval: 'daily',
      recurrenceCount: 1,
      recurrenceSeriesId: historicalOccurrence.recurrenceSeriesId,
    })
    expect(snapshot.tasks.find((row: any) => row.id === currentOccurrence.id)).toMatchObject({
      archived: false,
      recurrenceInterval: 'daily',
      recurrenceCount: 1,
      recurrenceSeriesId: historicalOccurrence.recurrenceSeriesId,
    })

    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain(otherProject.id)
    expect(serialized).not.toContain(otherStatuses[0]!.id)
    expect(serialized).not.toContain(otherTask.id)
  })
})
