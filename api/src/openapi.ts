import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { projectSchema } from './features/projects/router.js'
import { statusSchema } from './features/statuses/router.js'
import { taskSchema } from './features/tasks/router.js'

// Purely additive/descriptive: this file only describes the API surface
// already implemented under src/features/*/router.ts, by reusing their
// real Zod schemas. It has zero effect on runtime request validation -
// deleting it wouldn't change any endpoint's behavior.

const registry = new OpenAPIRegistry()

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
})

const BEARER = [{ bearerAuth: [] }]
const idParam = z.object({ id: z.string() })

function crud(basePath: string, tag: string, createSchema: z.ZodObject) {
  registry.registerPath({
    method: 'get', path: basePath, tags: [tag], summary: `List ${tag}`,
    security: BEARER, responses: { 200: { description: 'OK' } },
  })
  registry.registerPath({
    method: 'post', path: basePath, tags: [tag], summary: `Create a ${tag.slice(0, -1)}`,
    security: BEARER,
    request: { body: { content: { 'application/json': { schema: createSchema } } } },
    responses: { 201: { description: 'Created' } },
  })
  registry.registerPath({
    method: 'put', path: `${basePath}/{id}`, tags: [tag], summary: `Update a ${tag.slice(0, -1)}`,
    security: BEARER,
    request: { params: idParam, body: { content: { 'application/json': { schema: createSchema.partial() } } } },
    responses: { 200: { description: 'OK' }, 404: { description: 'Not found' } },
  })
  registry.registerPath({
    method: 'delete', path: `${basePath}/{id}`, tags: [tag], summary: `Delete/archive a ${tag.slice(0, -1)}`,
    security: BEARER, request: { params: idParam },
    responses: { 200: { description: 'OK' }, 404: { description: 'Not found' } },
  })
}

// ── Projects ─────────────────────────────────────────────────────────────
crud('/projects', 'projects', projectSchema)
registry.registerPath({
  method: 'post', path: '/projects/{id}/restore', tags: ['projects'], summary: 'Unarchive a project',
  security: BEARER, request: { params: idParam }, responses: { 200: { description: 'OK' } },
})

// ── Statuses ─────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/statuses', tags: ['statuses'], summary: "List a project's kanban statuses",
  security: BEARER,
  request: { query: z.object({ projectId: z.string() }) },
  responses: { 200: { description: 'OK' } },
})
registry.registerPath({
  method: 'post', path: '/statuses', tags: ['statuses'], summary: 'Create a custom status',
  security: BEARER,
  request: { body: { content: { 'application/json': { schema: statusSchema } } } },
  responses: { 201: { description: 'Created' } },
})
registry.registerPath({
  method: 'put', path: '/statuses/{id}', tags: ['statuses'], summary: 'Rename/recolor/reorder/toggle a status',
  security: BEARER,
  request: { params: idParam, body: { content: { 'application/json': { schema: statusSchema.partial().omit({ projectId: true }) } } } },
  responses: { 200: { description: 'OK' } },
})
registry.registerPath({
  method: 'delete', path: '/statuses/{id}', tags: ['statuses'], summary: 'Delete a status (reassigning its tasks first if needed)',
  security: BEARER,
  request: { params: idParam, query: z.object({ reassignTo: z.string().optional() }) },
  responses: { 200: { description: 'OK' }, 409: { description: 'Status still has tasks' } },
})

// ── Tasks ────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/tasks', tags: ['tasks'], summary: 'List tasks',
  security: BEARER,
  request: {
    query: z.object({
      projectId: z.string().optional(),
      parentTaskId: z.string().optional(),
      statusId: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
  },
  responses: { 200: { description: 'OK' } },
})
registry.registerPath({
  method: 'post', path: '/tasks', tags: ['tasks'], summary: 'Create a task or subtask',
  security: BEARER,
  request: { body: { content: { 'application/json': { schema: taskSchema } } } },
  responses: { 201: { description: 'Created' } },
})
registry.registerPath({
  method: 'put', path: '/tasks/{id}', tags: ['tasks'], summary: 'Update a task',
  security: BEARER,
  request: { params: idParam, body: { content: { 'application/json': { schema: taskSchema.partial() } } } },
  responses: { 200: { description: 'OK' } },
})
registry.registerPath({
  method: 'delete', path: '/tasks/{id}', tags: ['tasks'], summary: 'Archive a task and its whole subtree',
  security: BEARER, request: { params: idParam }, responses: { 200: { description: 'OK' } },
})
registry.registerPath({
  method: 'put', path: '/tasks/{id}/reorder', tags: ['tasks'], summary: 'Move a task to a different status/position (kanban drag)',
  security: BEARER,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: z.object({ statusId: z.string(), sortOrder: z.number().int() }) } } },
  },
  responses: { 200: { description: 'OK' } },
})

// ── Stats ────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/stats/summary', tags: ['stats'], summary: "Get the current user's task/project statistics",
  security: BEARER, responses: { 200: { description: 'OK' } },
})

// ── Users ────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/users/me', tags: ['users'], summary: "Get the current user's profile",
  security: BEARER, responses: { 200: { description: 'OK' } },
})
registry.registerPath({
  method: 'put', path: '/users/me', tags: ['users'], summary: "Update the current user's week-start preference",
  security: BEARER,
  request: {
    body: {
      content: {
        // weekStartsOn: 0 = Sunday, 1 = Monday
        'application/json': { schema: z.object({ weekStartsOn: z.union([z.literal(0), z.literal(1)]) }) },
      },
    },
  },
  responses: { 200: { description: 'OK' } },
})

export const openApiDocument = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.0',
  info: { title: 'Tafel API', version: '0.1.0' },
  servers: [{ url: '/' }],
})
