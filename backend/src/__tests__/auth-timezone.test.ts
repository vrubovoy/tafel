import { beforeEach, describe, expect, it, vi } from 'vitest'

const authCapture = vi.hoisted(() => ({
  onUserSeen: undefined as undefined | ((user: {
    id: string
    email: string
    name: string
    timezone: string | null
  }) => Promise<void>),
}))

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))
vi.mock('@zudar107/schloss-server-kit', () => ({
  createAuthMiddleware: vi.fn((options: { onUserSeen: typeof authCapture.onUserSeen }) => {
    authCapture.onUserSeen = options.onUserSeen
    return { requireAuth: vi.fn(), requireAdmin: vi.fn() }
  }),
  createExportAuthMiddleware: vi.fn(() => vi.fn()),
}))

import '../middleware/auth.js'
import { sqlite } from './helpers/db.js'

const user = {
  id: 'timezone-sync-user',
  email: 'timezone@example.com',
  name: 'Timezone User',
  timezone: 'America/Los_Angeles',
}

beforeEach(() => {
  sqlite.prepare('DELETE FROM users WHERE id = ?').run(user.id)
})

describe('authenticated user timezone synchronization', () => {
  it('stores a valid JWT timezone when provisioning a local user', async () => {
    await authCapture.onUserSeen!(user)

    expect(sqlite.prepare(
      'SELECT id, email, name, timezone FROM users WHERE id = ?',
    ).get(user.id)).toEqual(user)
  })

  it('replaces the persisted timezone when a later valid JWT changes it', async () => {
    await authCapture.onUserSeen!(user)
    await authCapture.onUserSeen!({ ...user, timezone: 'Europe/Berlin' })

    expect(sqlite.prepare('SELECT timezone FROM users WHERE id = ?').get(user.id)).toEqual({
      timezone: 'Europe/Berlin',
    })
  })

  it('retains the latest valid timezone when a later JWT has no timezone', async () => {
    await authCapture.onUserSeen!(user)
    await authCapture.onUserSeen!({ ...user, timezone: null })

    expect(sqlite.prepare('SELECT timezone FROM users WHERE id = ?').get(user.id)).toEqual({
      timezone: 'America/Los_Angeles',
    })
  })
})
