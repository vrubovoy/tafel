import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()

const H1 = { Authorization: 'Bearer test-token' }
const H2 = { Authorization: 'Bearer user2-token' }
const H_TIMEZONE = { Authorization: 'Bearer timezone-test-token' }
const JSON_H1 = { ...H1, 'Content-Type': 'application/json' }
const JSON_H_TIMEZONE = { ...H_TIMEZONE, 'Content-Type': 'application/json' }

const get = (path: string, headers = H1) => app.request(path, { headers })
const post = (path: string, body: unknown, headers = JSON_H1) =>
  app.request(path, { method: 'POST', headers, body: JSON.stringify(body) })

beforeEach(() => cleanDb())
afterEach(() => vi.useRealTimers())

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d!))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

async function createProjectWithStatuses(name = 'Project', headers = JSON_H1) {
  const project = (await (await post('/projects', { name }, headers)).json()) as any
  const statuses = (await (
    await app.request(`/statuses?projectId=${project.id}`, { headers })
  ).json()) as any[]
  const doneStatus = statuses.find((s) => s.isDone === true)!
  const notDoneStatuses = statuses.filter((s) => s.isDone === false)
  return { project, statuses, doneStatus, todoStatus: notDoneStatuses[0]! }
}

describe('GET /stats/summary', () => {
  // SUSPECTED BUG (see test report): with zero tasks, completedTasks and
  // overdueTasks are observed to come back as `null` rather than `0`
  // (looks like an unguarded SQL aggregate over an empty result set).
  it('returns zeroed-out stats when the caller has no data', async () => {
    const res = await get('/stats/summary')
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.totalTasks).toBe(0)
    expect(body.completedTasks).toBe(0)
    expect(body.completionRate).toBe(0)
    expect(body.overdueTasks).toBe(0)
    expect(body.tasksByProject).toEqual([])
    expect(body.completedLast14Days).toHaveLength(14)
    expect(body.currentStreak).toBe(0)
    expect(body.activeRecurringTasks).toBe(0)
  })

  it('computes totalTasks, completedTasks, and completionRate', async () => {
    const { project, doneStatus, todoStatus } = await createProjectWithStatuses()
    await post('/tasks', { projectId: project.id, statusId: doneStatus.id, title: 'Done 1' })
    await post('/tasks', { projectId: project.id, statusId: doneStatus.id, title: 'Done 2' })
    await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Not done' })

    const body = (await (await get('/stats/summary')).json()) as any
    expect(body.totalTasks).toBe(3)
    expect(body.completedTasks).toBe(2)
    expect(body.completionRate).toBeCloseTo(2 / 3)
  })

  it('counts overdue tasks (past dueDate, not completed)', async () => {
    const { project, todoStatus } = await createProjectWithStatuses()
    const yesterday = addDays(new Date().toISOString().slice(0, 10), -1)
    await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Overdue', dueDate: yesterday })

    const body = (await (await get('/stats/summary')).json()) as any
    expect(body.overdueTasks).toBe(1)
  })

  it('groups tasksByProject with the expected shape', async () => {
    const { project, doneStatus, todoStatus } = await createProjectWithStatuses('Grouped')
    await post('/tasks', { projectId: project.id, statusId: doneStatus.id, title: 'Done' })
    await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Not done' })

    const body = (await (await get('/stats/summary')).json()) as any
    expect(body.tasksByProject).toHaveLength(1)
    const entry = body.tasksByProject[0]!
    expect(entry.projectId).toBe(project.id)
    expect(entry.name).toBe('Grouped')
    expect(entry).toHaveProperty('color')
    expect(entry.total).toBe(2)
    expect(entry.completed).toBe(1)
  })

  // SUSPECTED BUG (see test report): completedLast14Days is observed to be
  // all-zero and currentStreak stays 0 even when tasks were completed today
  // and on the two preceding days (verified separately with fake timers
  // advancing across 3 consecutive days) - the aggregation appears to never
  // count anything.
  it('reflects a completed task in completedLast14Days and currentStreak', async () => {
    const { project, doneStatus } = await createProjectWithStatuses()
    await post('/tasks', { projectId: project.id, statusId: doneStatus.id, title: 'Completed today' })

    const body = (await (await get('/stats/summary')).json()) as any
    const totalCompletedInWindow = (body.completedLast14Days as number[]).reduce((a, b) => a + b, 0)
    expect(totalCompletedInWindow).toBeGreaterThanOrEqual(1)
    expect(body.currentStreak).toBeGreaterThanOrEqual(1)
  })

  it('calculates a current streak longer than the 14-day chart window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'))
    const { project, doneStatus } = await createProjectWithStatuses()

    for (let day = 1; day <= 15; day++) {
      vi.setSystemTime(new Date(`2026-01-${String(day).padStart(2, '0')}T12:00:00.000Z`))
      await post('/tasks', {
        projectId: project.id,
        statusId: doneStatus.id,
        title: `Completed on day ${day}`,
      })
    }

    const body = (await (await get('/stats/summary')).json()) as any
    expect(body.completedLast14Days).toHaveLength(14)
    expect(body.completedLast14Days).toEqual(Array(14).fill(1))
    expect(body.currentStreak).toBe(15)
  })

  it('calculates the current streak in the profile timezone', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T23:30:00.000Z'))
    const { project, doneStatus } = await createProjectWithStatuses(
      'Timezone project',
      JSON_H_TIMEZONE,
    )
    await post('/tasks', {
      projectId: project.id,
      statusId: doneStatus.id,
      title: 'Completed on the local day',
    }, JSON_H_TIMEZONE)

    // UTC has crossed into Jan 2, but Los Angeles is still on Jan 1.
    vi.setSystemTime(new Date('2026-01-02T01:00:00.000Z'))
    const body = (await (await get('/stats/summary', H_TIMEZONE)).json()) as any

    expect(body.currentStreak).toBe(1)
    expect(body.completedLast14Days.at(-1)).toBe(1)
  })

  it('counts activeRecurringTasks for tasks with a non-null recurrenceInterval that are not archived', async () => {
    const { project, todoStatus } = await createProjectWithStatuses()
    await post('/tasks', {
      projectId: project.id, statusId: todoStatus.id, title: 'Recurring', recurrenceInterval: 'weekly',
    })
    await post('/tasks', { projectId: project.id, statusId: todoStatus.id, title: 'Not recurring' })

    const body = (await (await get('/stats/summary')).json()) as any
    expect(body.activeRecurringTasks).toBe(1)
  })

  it('scopes stats to the caller only', async () => {
    const { project, doneStatus } = await createProjectWithStatuses('User1 project')
    await post('/tasks', { projectId: project.id, statusId: doneStatus.id, title: 'User1 task' })

    const user2Body = (await (await get('/stats/summary', H2)).json()) as any
    expect(user2Body.totalTasks).toBe(0)
    expect(user2Body.tasksByProject).toEqual([])
  })

  it('regenerates due recurring tasks (lazy trigger) so totalTasks reflects the new instance, not the archived template', async () => {
    const { project, doneStatus } = await createProjectWithStatuses()
    const yesterday = addDays(new Date().toISOString().slice(0, 10), -1)
    await post('/tasks', {
      projectId: project.id,
      statusId: doneStatus.id,
      title: 'Recurs via stats',
      dueDate: yesterday,
      recurrenceInterval: 'daily',
      recurrenceCount: 1,
    })

    const body = (await (await get('/stats/summary')).json()) as any
    // Exactly one task should exist: the regenerated instance (template archived, excluded).
    expect(body.totalTasks).toBe(1)
  })
})
