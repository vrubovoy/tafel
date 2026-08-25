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
  description: 'Schlüssel access token with token_use=access.',
})
registry.registerComponent('securitySchemes', 'exportDelegation', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'Short-lived Schlüssel delegation with token_use=export, the exact data:export scope, and the hof-service:tafel audience.',
})
registry.registerComponent('securitySchemes', 'deletionAuth', {
  type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
  description: 'Short-lived Schlüssel deletion token with exact hof-deletion:tafel audience and account:delete scope.',
})

const BEARER = [{ bearerAuth: [] }]
const EXPORT_BEARER: Record<string, string[]>[] = [{ bearerAuth: [] }, { exportDelegation: [] }]
const idParam = z.object({ id: z.string() })
const dateTime = z.string().datetime()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const errorResponseSchema = z.object({ error: z.string() })
const okResponseSchema = z.object({ ok: z.literal(true) })

const userProfileResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  weekStartsOn: z.number().int().min(0).max(1),
  weekStartsOnOverride: z.number().int().min(0).max(1).nullable(),
  dateFormat: z.enum(['dmy', 'mdy', 'ymd']).meta({ nullable: true }),
  timezone: z.string().nullable(),
})

const projectResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  color: z.string(),
  icon: z.string(),
  sortOrder: z.number().int(),
  archived: z.boolean(),
  createdAt: dateTime,
})

const projectUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  icon: z.string().max(50).optional(),
  sortOrder: z.number().int().optional(),
})

const statusResponseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  color: z.string(),
  sortOrder: z.number().int(),
  isDone: z.boolean().describe('Whether tasks in this status count as complete'),
  createdAt: dateTime,
})

const statusUpdateSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  sortOrder: z.number().int().optional(),
  isDone: z.boolean().optional().describe(
    'Changing this sets or clears completedAt on active tasks in the status; archived task history is unchanged',
  ),
})

const taskResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  projectId: z.string(),
  parentTaskId: z.string().nullable(),
  statusId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(['low', 'medium', 'high']),
  dueDate: isoDate.nullable(),
  sortOrder: z.number().int().describe('Order within the task\'s parent and status'),
  completedAt: dateTime.nullable().describe(
    'Current completion timestamp: set on a non-done to done transition, preserved between done statuses, and cleared on a transition to non-done',
  ),
  recurrenceInterval: z.enum(['daily', 'weekly', 'monthly']).nullable(),
  recurrenceCount: z.number().int().positive().nullable(),
  recurrenceAnchorDate: isoDate.nullable().describe('Schedule anchor carried forward to generated occurrences'),
  recurrenceSeriesId: z.string().nullable().describe('Stable identity shared by every occurrence in one recurrence series'),
  archived: z.boolean(),
  archivedByProject: z.boolean().describe('True when the task was hidden by project archiving rather than explicitly archived'),
  createdAt: dateTime,
})

const taskUpdateSchema = z.object({
  projectId: z.string().optional(),
  parentTaskId: z.string().nullable().optional(),
  statusId: z.string().optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  dueDate: isoDate.nullable().optional(),
  sortOrder: z.number().int().optional(),
  recurrenceInterval: z.enum(['daily', 'weekly', 'monthly']).nullable().optional(),
  recurrenceCount: z.number().int().positive().nullable().optional(),
})

const statsResponseSchema = z.object({
  totalTasks: z.number().int().nonnegative(),
  completedTasks: z.number().int().nonnegative(),
  completionRate: z.number().min(0).max(1),
  overdueTasks: z.number().int().nonnegative(),
  tasksByProject: z.array(z.object({
    projectId: z.string(),
    name: z.string(),
    color: z.string(),
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
  })),
  completedLast14Days: z.array(z.number().int().nonnegative()).length(14).meta({
    minItems: 14,
    maxItems: 14,
    description: 'Oldest-to-newest completion counts for 14 profile-timezone calendar days, including today',
  }),
  currentStreak: z.number().int().nonnegative().describe(
    'Consecutive profile-timezone calendar days with a completion, including archived completion history, counted backward from today over complete history',
  ),
  activeRecurringTasks: z.number().int().nonnegative(),
})

const exportResponseSchema = z.object({
  scope: z.literal('tafel-account-only').describe('This export contains Tafel data only, not platform-wide account data'),
  exportedAt: dateTime,
  projects: z.array(projectResponseSchema).describe('All caller-owned projects, including archived projects'),
  statuses: z.array(statusResponseSchema).describe('Statuses belonging to the exported projects'),
  tasks: z.array(taskResponseSchema).describe('All caller-owned tasks, including archived and historical recurrence occurrences'),
})

const tafelSnapshotSchema = z.object({
  weekStartsOn: z.number().int().min(0).max(1).nullable().describe(
    'Nullable Tafel-local week-start override; 0 is Sunday and 1 is Monday',
  ),
  projects: z.array(projectResponseSchema).describe('All subject-owned projects, including archived projects'),
  statuses: z.array(statusResponseSchema).describe('Every status belonging to the exported projects'),
  tasks: z.array(taskResponseSchema).describe(
    'All subject-owned tasks, including archived tasks and historical recurrence occurrences',
  ),
}).strict()

const standardizedExportResponseSchema = z.object({
  version: z.literal('1'),
  service: z.literal('tafel'),
  exportedAt: dateTime,
  data: tafelSnapshotSchema,
}).strict()

const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } })
const error = (description: string) => ({ description, ...json(errorResponseSchema) })
const invalid = (description: string) => ({ description })

// ── Projects ─────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/projects', tags: ['projects'], summary: 'List active or archived projects',
  description: 'Returns active projects by default. archived=true returns archived projects instead.',
  security: BEARER,
  request: { query: z.object({
    archived: z.enum(['true', 'false']).optional().describe('Set to true to list archived projects; false is the default'),
  }) },
  responses: { 200: { description: 'Projects owned by the caller', ...json(z.array(projectResponseSchema)) } },
})
registry.registerPath({
  method: 'post', path: '/projects', tags: ['projects'], summary: 'Create a project',
  description: 'Creates the project and its three default statuses in one transaction.',
  security: BEARER,
  request: { body: { content: { 'application/json': { schema: projectSchema } } } },
  responses: {
    201: { description: 'Created project', ...json(projectResponseSchema) },
    400: invalid('Invalid request body'),
  },
})
registry.registerPath({
  method: 'put', path: '/projects/{id}', tags: ['projects'], summary: 'Partially update a project',
  description: 'Omitted fields are preserved.',
  security: BEARER,
  request: { params: idParam, body: { content: { 'application/json': { schema: projectUpdateSchema } } } },
  responses: {
    200: { description: 'Updated project', ...json(projectResponseSchema) },
    400: invalid('Invalid request body'),
    404: error('Project not found'),
  },
})
registry.registerPath({
  method: 'delete', path: '/projects/{id}', tags: ['projects'], summary: 'Archive a project and its active tasks',
  description: 'Marks the project archived and marks only currently active tasks as archivedByProject.',
  security: BEARER,
  request: { params: idParam },
  responses: {
    200: { description: 'Project archived', ...json(okResponseSchema) },
    404: error('Project not found'),
  },
})
registry.registerPath({
  method: 'post', path: '/projects/{id}/restore', tags: ['projects'], summary: 'Restore a project',
  description: 'Restores the project and only tasks whose archivedByProject marker shows that project archiving hid them. Explicitly archived tasks remain archived.',
  security: BEARER,
  request: { params: idParam },
  responses: {
    200: { description: 'Restored project', ...json(projectResponseSchema) },
    404: error('Project not found'),
  },
})

// ── Statuses ─────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/statuses', tags: ['statuses'], summary: "List a project's kanban statuses",
  security: BEARER,
  request: { query: z.object({ projectId: z.string() }) },
  responses: {
    200: { description: 'Statuses ordered by sortOrder', ...json(z.array(statusResponseSchema)) },
    400: invalid('projectId is required'),
    404: error('Project not found'),
  },
})
registry.registerPath({
  method: 'post', path: '/statuses', tags: ['statuses'], summary: 'Create a custom status',
  security: BEARER,
  request: { body: { content: { 'application/json': { schema: statusSchema } } } },
  responses: {
    201: { description: 'Created status', ...json(statusResponseSchema) },
    400: invalid('Invalid request body'),
    404: error('Project not found'),
  },
})
registry.registerPath({
  method: 'put', path: '/statuses/{id}', tags: ['statuses'], summary: 'Partially update a status',
  description: 'Omitted fields are preserved. Changing isDone updates completedAt for active tasks in this status but does not rewrite archived task history.',
  security: BEARER,
  request: { params: idParam, body: { content: { 'application/json': { schema: statusUpdateSchema } } } },
  responses: {
    200: { description: 'Updated status', ...json(statusResponseSchema) },
    400: invalid('Invalid request body'),
    404: error('Status or owning project not found'),
  },
})
registry.registerPath({
  method: 'delete', path: '/statuses/{id}', tags: ['statuses'], summary: 'Delete a status (reassigning its tasks first if needed)',
  description: 'Every active or archived task reference blocks deletion unless reassignTo names another status in the same project. Reassignment updates completion state for active tasks and preserves archived tasks\' completedAt history.',
  security: BEARER,
  request: { params: idParam, query: z.object({
    reassignTo: z.string().optional().describe('Required when any active or archived task references this status'),
  }) },
  responses: {
    200: { description: 'Status deleted', ...json(okResponseSchema) },
    404: error('Status, owning project, or reassignment status not found'),
    409: error('Status still has tasks and reassignTo was omitted'),
  },
})

// ── Tasks ────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/tasks', tags: ['tasks'], summary: 'List tasks',
  description: 'Returns active tasks only and lazily advances due completed recurrence series before reading.',
  security: BEARER,
  request: {
    query: z.object({
      projectId: z.string().optional(),
      parentTaskId: z.string().optional().describe('Omit for every depth, pass an empty value for roots only, or pass an id for direct children only'),
      statusId: z.string().optional(),
      from: z.string().optional().describe('Inclusive minimum due date; use YYYY-MM-DD'),
      to: z.string().optional().describe('Inclusive maximum due date; use YYYY-MM-DD'),
    }),
  },
  responses: { 200: { description: 'Caller-owned active tasks matching all filters', ...json(z.array(taskResponseSchema)) } },
})
registry.registerPath({
  method: 'post', path: '/tasks', tags: ['tasks'], summary: 'Create a task or subtask',
  description: 'The project, status, and optional parent must belong to the caller and agree on project. A recurring task starts a new recurrence series.',
  security: BEARER,
  request: { body: { content: { 'application/json': { schema: taskSchema } } } },
  responses: {
    201: { description: 'Created task', ...json(taskResponseSchema) },
    400: invalid('Invalid request body'),
    404: error('Project, status, or parent task not found'),
    409: error('Project is archived'),
    422: error('Parent task belongs to a different project'),
  },
})
registry.registerPath({
  method: 'put', path: '/tasks/{id}', tags: ['tasks'], summary: 'Partially update or reparent a task',
  description: 'Omitted fields are preserved. Reparenting cannot create a cycle. Moving projects detaches the subtree root and moves every descendant to the target project, assigning target-project statuses.',
  security: BEARER,
  request: { params: idParam, body: { content: { 'application/json': { schema: taskUpdateSchema } } } },
  responses: {
    200: { description: 'Updated task', ...json(taskResponseSchema) },
    400: invalid('Invalid request body'),
    404: error('Task, project, status, or parent task not found'),
    409: error('Source or target project is archived'),
    422: error('Cross-project parent or recursive parent cycle'),
  },
})
registry.registerPath({
  method: 'delete', path: '/tasks/{id}', tags: ['tasks'], summary: 'Archive a task and its whole subtree',
  description: 'Recursively archives the selected task and every descendant at any depth as an explicit task archive.',
  security: BEARER,
  request: { params: idParam },
  responses: {
    200: { description: 'Task subtree archived', ...json(okResponseSchema) },
    404: error('Task not found'),
  },
})
registry.registerPath({
  method: 'post', path: '/tasks/{id}/restore', tags: ['tasks'], summary: 'Restore a task and its whole subtree',
  description: 'The project and every ancestor must already be active. Descendants are restored recursively except historical recurrence occurrences for which a later occurrence exists.',
  security: BEARER,
  request: { params: idParam },
  responses: {
    200: { description: 'Restored task subtree root', ...json(taskResponseSchema) },
    404: error('Task not found'),
    409: error('Project or required ancestor is archived, or a later occurrence exists in this recurrence series'),
  },
})
registry.registerPath({
  method: 'put', path: '/tasks/{id}/reorder', tags: ['tasks'], summary: 'Move a task to a different status/position (kanban drag)',
  description: 'Reorders only among tasks with the same parent. Moving into or out of a done status updates completedAt using the normal status-transition rules.',
  security: BEARER,
  request: {
    params: idParam,
    body: { content: { 'application/json': { schema: z.object({ statusId: z.string(), sortOrder: z.number().int() }) } } },
  },
  responses: {
    200: { description: 'Reordered task', ...json(taskResponseSchema) },
    400: invalid('Invalid request body'),
    404: error('Task or target-project status not found'),
  },
})

// ── Stats ────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/stats/summary', tags: ['stats'], summary: "Get the current user's task/project statistics",
  description: 'Lazily advances due recurrence series. Overdue dates, the 14-day trend, and the streak use the profile timezone from the bearer token; without one they use UTC. Trend and streak history includes archived completed occurrences.',
  security: BEARER,
  responses: { 200: { description: 'Caller-owned task and project statistics', ...json(statsResponseSchema) } },
})

// ── Users ────────────────────────────────────────────────────────────────
registry.registerPath({
  method: 'get', path: '/users/me', tags: ['users'], summary: "Get the current user's profile",
  description: 'weekStartsOn is effective; weekStartsOnOverride is the nullable Tafel-local value. dateFormat and timezone are read-only passthrough values from the Schlüssel token.',
  security: BEARER,
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: userProfileResponseSchema } } } },
})
registry.registerPath({
  method: 'get', path: '/users/export', tags: ['users'], summary: "Export the current user's Tafel data as JSON",
  description: 'Retained synchronous direct Tafel-only JSON contract. Exports all caller-owned projects, their statuses, and tasks, including archived data. It does not export profile data, credentials/tokens, runtime or operational state, other users, or data from other Hof services. The response is private, no-store, and nosniff.',
  security: BEARER,
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: exportResponseSchema } } } },
})
registry.registerPath({
  method: 'get', path: '/exports/me', tags: ['exports'], summary: 'Export a complete versioned Tafel snapshot',
  description: 'Synchronous direct Tafel JSON endpoint used by Settings and as an input to Schlüssel\'s separate asynchronous ZIP collector. Reads the subject-owned local weekStartsOn override, projects, statuses, and tasks in one local SQLite transaction, including archived rows and recurrence history. Accepts a normal Schlüssel access token or a JWKS-verified delegation with the exact issuer, token_use=export, single hof-service:tafel audience, data:export scope, nonempty subject/job/token IDs, and a non-expired numeric expiry; delegation is rejected by ordinary routes. This is not a cross-service point-in-time snapshot. Account credentials/tokens, runtime configuration, logs, internal operational state, other users, and other services are excluded. The response is private, no-store, and nosniff.',
  security: EXPORT_BEARER,
  responses: {
    200: { description: 'Strict Tafel export envelope version 1', ...json(standardizedExportResponseSchema) },
    401: error('Missing, invalid, expired, or incorrectly scoped token'),
  },
})
registry.registerPath({
  method: 'put', path: '/users/me', tags: ['users'], summary: "Update the current user's week-start preference",
  description: '0 selects Sunday, 1 selects Monday, and null clears the Tafel override. The effective value then falls back to the Schlüssel profile and finally Monday.',
  security: BEARER,
  request: {
    body: {
      content: {
        // weekStartsOn: 0 = Sunday, 1 = Monday
        'application/json': { schema: z.object({ weekStartsOn: z.number().int().min(0).max(1).nullable() }) },
      },
    },
  },
  responses: {
    200: { description: 'Updated profile', ...json(userProfileResponseSchema) },
    400: invalid('weekStartsOn is missing or invalid'),
  },
})

registry.registerPath({
  method: 'post', path: '/internal/v1/account-deletions', tags: ['internal'], summary: 'Idempotently purge a deleted account',
  security: [{ deletionAuth: [] }], request: { body: { content: { 'application/json': { schema: z.object({ jobId: z.string(), userId: z.string() }).strict() } } } },
  responses: {
    200: { description: 'Deletion completed or exact replay accepted' },
    401: { description: 'Missing, invalid, expired, or incorrectly scoped token' },
    409: { description: 'Token, payload, job, or subject identity conflict' },
  },
})

export const openApiDocument = new OpenApiGeneratorV3(registry.definitions).generateDocument({
  openapi: '3.0.0',
  info: {
    title: 'Tafel API',
    version: '0.1.0',
    description: 'Account-scoped task tracking API. Status history is represented by each task\'s current status and completedAt timestamp; there is no status-event-log endpoint.',
  },
  servers: [{ url: '/' }],
})
