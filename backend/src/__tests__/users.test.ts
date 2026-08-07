import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()

const H1 = { Authorization: 'Bearer test-token' }
const H2 = { Authorization: 'Bearer user2-token' }

const get = (path: string, headers = H1) => app.request(path, { headers })

const put = (path: string, body: unknown, headers = H1) =>
  app.request(path, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => cleanDb())

describe('GET /users/me', () => {
  it("returns the authenticated caller's own profile", async () => {
    const res = await get('/users/me')
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.id).toBe('user-1')
    expect(body.email).toBe('test@example.com')
    expect(body).toHaveProperty('name')
  })

  it('returns the correct profile for a different authenticated user', async () => {
    const res = await get('/users/me', H2)
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.id).toBe('user-2')
    expect(body.email).toBe('test2@example.com')
  })

  it('returns 401 without an Authorization header', async () => {
    const res = await app.request('/users/me')
    expect(res.status).toBe(401)
  })

  it('returns 401 for an invalid token', async () => {
    const res = await get('/users/me', { Authorization: 'Bearer bad-token' })
    expect(res.status).toBe(401)
  })

  it('defaults weekStartsOn to 1 (Monday) for a freshly-provisioned user', async () => {
    const res = await get('/users/me')
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.weekStartsOn).toBe(1)
  })
})

describe('PUT /users/me', () => {
  it('updates weekStartsOn to 0 and returns the updated profile', async () => {
    const res = await put('/users/me', { weekStartsOn: 0 })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.id).toBe('user-1')
    expect(body.email).toBe('test@example.com')
    expect(body).toHaveProperty('name')
    expect(body.weekStartsOn).toBe(0)
  })

  it('updates weekStartsOn to 1 and returns the updated profile', async () => {
    // First move it away from the default so this exercises a real change.
    await put('/users/me', { weekStartsOn: 0 })
    const res = await put('/users/me', { weekStartsOn: 1 })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.weekStartsOn).toBe(1)
  })

  it('persists the update - a follow-up GET reflects the new value', async () => {
    const putRes = await put('/users/me', { weekStartsOn: 0 })
    expect(putRes.status).toBe(200)

    const getRes = await get('/users/me')
    expect(getRes.status).toBe(200)
    const body = (await getRes.json()) as any
    expect(body.weekStartsOn).toBe(0)
  })

  // Note: the test users table is shared across tests in this file (cleanDb()
  // only truncates tasks/statuses/projects, per helpers/db.ts), so each of the
  // following "rejects" tests first establishes its own known baseline via a
  // valid PUT rather than assuming the freshly-provisioned default survived
  // whatever earlier tests in this file already did.

  it('rejects an out-of-range integer (2) with 400 and does not change the persisted value', async () => {
    await put('/users/me', { weekStartsOn: 1 })
    const res = await put('/users/me', { weekStartsOn: 2 })
    expect(res.status).toBe(400)

    const getRes = await get('/users/me')
    const body = (await getRes.json()) as any
    expect(body.weekStartsOn).toBe(1)
  })

  it('rejects a string value ("1") with 400 and does not change the persisted value', async () => {
    await put('/users/me', { weekStartsOn: 1 })
    const res = await put('/users/me', { weekStartsOn: '1' })
    expect(res.status).toBe(400)

    const getRes = await get('/users/me')
    const body = (await getRes.json()) as any
    expect(body.weekStartsOn).toBe(1)
  })

  it('rejects a missing weekStartsOn field with 400 and does not change the persisted value', async () => {
    await put('/users/me', { weekStartsOn: 0 })
    const res = await put('/users/me', {})
    expect(res.status).toBe(400)

    const getRes = await get('/users/me')
    const body = (await getRes.json()) as any
    expect(body.weekStartsOn).toBe(0)
  })

  it('accepts a null weekStartsOn, clearing the Tafel-specific override back to the platform default', async () => {
    await put('/users/me', { weekStartsOn: 0 })
    const res = await put('/users/me', { weekStartsOn: null })
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.weekStartsOnOverride).toBe(null)
    // The mock auth user has no platform-wide weekStart preference either
    // (see helpers/auth-mock.ts), so the effective value falls all the
    // way back to Tafel's own historical default, Monday.
    expect(body.weekStartsOn).toBe(1)

    const getRes = await get('/users/me')
    const getBody = (await getRes.json()) as any
    expect(getBody.weekStartsOnOverride).toBe(null)
    expect(getBody.weekStartsOn).toBe(1)
  })

  it('returns 401 without an Authorization header', async () => {
    const res = await app.request('/users/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekStartsOn: 0 }),
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 for an invalid token', async () => {
    const res = await put('/users/me', { weekStartsOn: 0 }, { Authorization: 'Bearer bad-token' })
    expect(res.status).toBe(401)
  })

  it("updating user-1's weekStartsOn does not affect user-2's stored value", async () => {
    const putRes = await put('/users/me', { weekStartsOn: 0 })
    expect(putRes.status).toBe(200)

    const user2Res = await get('/users/me', H2)
    expect(user2Res.status).toBe(200)
    const user2Body = (await user2Res.json()) as any
    expect(user2Body.weekStartsOn).toBe(1)
  })
})
