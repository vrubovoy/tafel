import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

import { cleanDb } from './helpers/db.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()

const H1 = { Authorization: 'Bearer test-token' }
const H2 = { Authorization: 'Bearer user2-token' }

const get = (path: string, headers = H1) => app.request(path, { headers })

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
})
