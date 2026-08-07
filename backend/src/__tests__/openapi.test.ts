import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/index.js', () => ({ db: {} }))
vi.mock('../middleware/auth.js', () => ({ requireAuth: vi.fn() }))

import { openApiDocument } from '../openapi.js'

function resolveSchema(schema: any): any {
  if (!schema?.$ref) return schema
  const name = schema.$ref.split('/').at(-1)!
  return (openApiDocument.components?.schemas as Record<string, unknown> | undefined)?.[name]
}

function jsonResponseSchema(path: string) {
  const operation = openApiDocument.paths?.[path]?.get as any
  return resolveSchema(operation?.responses?.['200']?.content?.['application/json']?.schema)
}

function operation(path: string, method: 'get' | 'post' | 'put' | 'delete') {
  return openApiDocument.paths?.[path]?.[method] as any
}

function requestBodySchema(path: string, method: 'post' | 'put') {
  const requestBody = operation(path, method)?.requestBody as any
  return resolveSchema(requestBody?.content?.['application/json']?.schema)
}

function responseSchema(path: string, method: 'get' | 'post' | 'put' | 'delete', status: string) {
  return resolveSchema(operation(path, method)?.responses?.[status]?.content?.['application/json']?.schema)
}

describe('OpenAPI user preference schema', () => {
  it('documents null as a valid weekStartsOn value', () => {
    const requestBody = openApiDocument.paths?.['/users/me']?.put?.requestBody as any
    const schema = requestBody.content['application/json'].schema
    expect(schema.required).toContain('weekStartsOn')
    expect(schema.properties.weekStartsOn).toMatchObject({ nullable: true })
  })

  it('documents the complete GET /users/me response', () => {
    const schema = jsonResponseSchema('/users/me')

    expect(schema).toMatchObject({ type: 'object' })
    expect(schema.required).toEqual(expect.arrayContaining([
      'id', 'email', 'name', 'weekStartsOn', 'weekStartsOnOverride', 'dateFormat', 'timezone',
    ]))
    expect(schema.properties).toMatchObject({
      id: { type: 'string' },
      email: { type: 'string' },
      name: { type: 'string' },
      weekStartsOn: { type: 'integer', minimum: 0, maximum: 1 },
      weekStartsOnOverride: { type: 'integer', minimum: 0, maximum: 1, nullable: true },
      dateFormat: { type: 'string', enum: ['dmy', 'mdy', 'ymd'], nullable: true },
      timezone: { type: 'string', nullable: true },
    })
  })

  it('documents the GET /users/export envelope and entity arrays', () => {
    const schema = jsonResponseSchema('/users/export')

    expect(schema).toMatchObject({ type: 'object' })
    expect(schema.required).toEqual(expect.arrayContaining([
      'scope', 'exportedAt', 'projects', 'statuses', 'tasks',
    ]))
    expect(schema.properties.scope).toMatchObject({
      type: 'string',
      enum: ['tafel-account-only'],
    })
    expect(schema.properties.exportedAt).toMatchObject({ type: 'string', format: 'date-time' })
    for (const key of ['projects', 'statuses', 'tasks']) {
      expect(schema.properties[key]).toMatchObject({
        type: 'array',
      })
    }
    expect(resolveSchema(schema.properties.projects.items).required).toEqual(expect.arrayContaining([
      'id', 'userId', 'name', 'color', 'icon', 'sortOrder', 'archived', 'createdAt',
    ]))
    expect(resolveSchema(schema.properties.statuses.items).required).toEqual(expect.arrayContaining([
      'id', 'projectId', 'name', 'color', 'sortOrder', 'isDone', 'createdAt',
    ]))
    expect(resolveSchema(schema.properties.tasks.items).required).toEqual(expect.arrayContaining([
      'id', 'userId', 'projectId', 'parentTaskId', 'statusId', 'title', 'description',
      'priority', 'dueDate', 'sortOrder', 'completedAt', 'recurrenceInterval',
      'recurrenceCount', 'recurrenceAnchorDate', 'recurrenceSeriesId', 'archived',
      'archivedByProject', 'createdAt',
    ]))
  })
})

describe('OpenAPI archive and restore contracts', () => {
  it('documents the archived project-list query parameter', () => {
    const operation = openApiDocument.paths?.['/projects']?.get as any

    expect(operation.parameters ?? []).toContainEqual(expect.objectContaining({
      in: 'query',
      name: 'archived',
    }))
  })

  it('documents task restore conflicts', () => {
    const operation = openApiDocument.paths?.['/tasks/{id}/restore']?.post as any

    expect(operation.responses).toHaveProperty('409')
  })

  it('documents project archive provenance and task ancestor/series restore rules', () => {
    expect(operation('/projects/{id}', 'delete').description).toMatch(/archivedByProject/)
    expect(operation('/projects/{id}/restore', 'post').description).toMatch(/Explicitly archived tasks remain archived/)
    expect(operation('/tasks/{id}', 'delete').description).toMatch(/every descendant at any depth/)
    expect(operation('/tasks/{id}/restore', 'post').description).toMatch(/historical recurrence occurrences/)
    expect(operation('/tasks/{id}/restore', 'post').responses['409'].description).toMatch(/recurrence series/)
  })
})

describe('OpenAPI entity and partial-update contracts', () => {
  it('describes entity schemas for every CRUD success response', () => {
    const cases = [
      ['/projects', 'get', '200', 'array'],
      ['/projects', 'post', '201', 'object'],
      ['/projects/{id}', 'put', '200', 'object'],
      ['/projects/{id}/restore', 'post', '200', 'object'],
      ['/statuses', 'get', '200', 'array'],
      ['/statuses', 'post', '201', 'object'],
      ['/statuses/{id}', 'put', '200', 'object'],
      ['/tasks', 'get', '200', 'array'],
      ['/tasks', 'post', '201', 'object'],
      ['/tasks/{id}', 'put', '200', 'object'],
      ['/tasks/{id}/restore', 'post', '200', 'object'],
      ['/tasks/{id}/reorder', 'put', '200', 'object'],
    ] as const

    for (const [path, method, status, type] of cases) {
      expect(responseSchema(path, method, status), `${method.toUpperCase()} ${path}`).toMatchObject({ type })
    }
  })

  it('uses exact update schemas with no create defaults or required fields', () => {
    const project = requestBodySchema('/projects/{id}', 'put')
    const status = requestBodySchema('/statuses/{id}', 'put')
    const task = requestBodySchema('/tasks/{id}', 'put')

    expect(project.required).toBeUndefined()
    expect(status.required).toBeUndefined()
    expect(task.required).toBeUndefined()
    expect(Object.keys(project.properties)).toEqual(['name', 'color', 'icon', 'sortOrder'])
    expect(Object.keys(status.properties)).toEqual(['name', 'color', 'sortOrder', 'isDone'])
    expect(status.properties).not.toHaveProperty('projectId')
    expect(Object.keys(task.properties)).toEqual([
      'projectId', 'parentTaskId', 'statusId', 'title', 'description', 'priority',
      'dueDate', 'sortOrder', 'recurrenceInterval', 'recurrenceCount',
    ])

    for (const schema of [project, status, task]) {
      for (const property of Object.values(schema.properties) as any[]) {
        expect(property).not.toHaveProperty('default')
      }
    }
  })

  it('documents status-driven completion history semantics', () => {
    const task = responseSchema('/tasks', 'post', '201')
    const statusUpdate = requestBodySchema('/statuses/{id}', 'put')

    expect(task.properties.completedAt.description).toMatch(/preserved between done statuses/)
    expect(statusUpdate.properties.isDone.description).toMatch(/archived task history is unchanged/)
    expect(operation('/statuses/{id}', 'delete').description).toMatch(/preserves archived tasks' completedAt history/)
    expect(openApiDocument.info.description).toMatch(/no status-event-log endpoint/)
  })
})

describe('OpenAPI recurrence, hierarchy, stats, and export contracts', () => {
  it('documents recurrence-series identity and lazy advancement', () => {
    const task = responseSchema('/tasks', 'post', '201')

    expect(task.properties.recurrenceSeriesId.description).toMatch(/Stable identity/)
    expect(task.properties.recurrenceAnchorDate.description).toMatch(/carried forward/)
    expect(operation('/tasks', 'get').description).toMatch(/lazily advances/)
  })

  it('documents recursive list, direct-child kanban, and sibling reorder scoping', () => {
    const parameters = operation('/tasks', 'get').parameters as any[]
    const parentTaskId = parameters.find((parameter) => parameter.name === 'parentTaskId')

    expect(parentTaskId.description).toMatch(/Omit for every depth/)
    expect(parentTaskId.description).toMatch(/direct children only/)
    expect(operation('/tasks/{id}/reorder', 'put').description).toMatch(/same parent/)
    expect(operation('/tasks/{id}', 'put').responses).toHaveProperty('422')
  })

  it('documents the complete timezone-aware stats response', () => {
    const schema = jsonResponseSchema('/stats/summary')

    expect(schema.required).toEqual(expect.arrayContaining([
      'totalTasks', 'completedTasks', 'completionRate', 'overdueTasks', 'tasksByProject',
      'completedLast14Days', 'currentStreak', 'activeRecurringTasks',
    ]))
    expect(schema.properties.completedLast14Days).toMatchObject({ type: 'array', minItems: 14, maxItems: 14 })
    expect(schema.properties.currentStreak.description).toMatch(/complete history/)
    expect(operation('/stats/summary', 'get').description).toMatch(/profile timezone/)
  })

  it('documents account-only export inclusion and exclusions', () => {
    const schema = jsonResponseSchema('/users/export')

    expect(schema.properties.scope.description).toMatch(/Tafel data only/)
    expect(schema.properties.projects.description).toMatch(/including archived/)
    expect(schema.properties.tasks.description).toMatch(/historical recurrence occurrences/)
    expect(operation('/users/export', 'get').description).toMatch(/does not export profile data/)
  })
})
