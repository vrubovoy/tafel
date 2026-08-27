import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('../middleware/auth.js', async () => await import('./helpers/auth-mock.js'))

// Import order matters here - see the module comment in jwksTestServer.ts.
import { setJwksShouldFail } from './helpers/jwksTestServer.js'
import { createTestApp } from './helpers/setup.js'

const app = createTestApp()

describe('GET /health', () => {
  it('succeeds with no Authorization header at all', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status?: string; service?: string }
    expect(body.status).toBe('ok')
    expect(body.service).toBe('Tafel')
  })
})

describe('GET /ready', () => {
  it('succeeds when Schlüssel is reachable', async () => {
    setJwksShouldFail(false)
    const res = await app.request('/ready')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status?: string; service?: string }
    expect(body.status).toBe('ready')
    expect(body.service).toBe('Tafel')
  })

  it('reports unavailable when Schlüssel is not reachable', async () => {
    setJwksShouldFail(true)
    const res = await app.request('/ready')
    expect(res.status).toBe(503)
    const body = (await res.json()) as { status?: string; service?: string }
    expect(body.status).toBe('unavailable')
    expect(body.service).toBe('Tafel')
  })
})
