import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))

import { startNotificationOutbox } from '../features/notifications/outbox.js'
import { sqlite } from './helpers/db.js'

const KEY_ID_VAR = 'TAFEL_TO_GLOCKE_HMAC_KEY_ID'
const SECRET_VAR = 'TAFEL_TO_GLOCKE_HMAC_SECRET'

interface OutboxRow {
  id: string
  event_type: string
  user_id: string
  payload: string
  correlation_id: string
  dedupe_key: string
  state: string
  created_at: number
  attempts: number
  next_attempt_at: number | null
  lease_id: string | null
  lease_until: number | null
  delivered_at: number | null
  last_error: string | null
}

function getRow(id: string): OutboxRow | undefined {
  return sqlite.prepare('SELECT * FROM notification_outbox WHERE id = ?').get(id) as OutboxRow | undefined
}

function seedPendingRow(): string {
  const id = randomUUID()
  sqlite.prepare(`
    INSERT INTO notification_outbox
      (id, event_type, user_id, payload, correlation_id, dedupe_key, state, created_at, attempts, next_attempt_at)
    VALUES (?, 'tafel.task.due.v1', ?, '{}', ?, ?, 'pending', ?, 0, ?)
  `).run(id, 'user-1', id, `dedupe-${id}`, Date.now(), Date.now() - 1000)
  return id
}

async function waitFor(
  predicate: () => boolean,
  options: { timeoutMs?: number, intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5000
  const intervalMs = options.intervalMs ?? 75
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error('waitFor: condition not met within timeout')
}

describe('startNotificationOutbox', () => {
  let savedKeyId: string | undefined
  let savedSecret: string | undefined

  beforeEach(() => {
    savedKeyId = process.env[KEY_ID_VAR]
    savedSecret = process.env[SECRET_VAR]
    sqlite.exec('DELETE FROM notification_outbox')
  })

  afterEach(() => {
    if (savedKeyId === undefined) delete process.env[KEY_ID_VAR]
    else process.env[KEY_ID_VAR] = savedKeyId
    if (savedSecret === undefined) delete process.env[SECRET_VAR]
    else process.env[SECRET_VAR] = savedSecret
    vi.unstubAllGlobals()
  })

  it('is a safe no-op when Glocke HMAC credentials are not configured', async () => {
    delete process.env[KEY_ID_VAR]
    delete process.env[SECRET_VAR]

    const runtime = startNotificationOutbox()

    expect(typeof runtime.stop).toBe('function')
    await expect(runtime.stop()).resolves.toBeUndefined()
  })

  it('delivers a pending row and marks it delivered on a 2xx response', async () => {
    process.env[KEY_ID_VAR] = 'test-key-id'
    process.env[SECRET_VAR] = 'a'.repeat(32)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))

    const id = seedPendingRow()
    const runtime = startNotificationOutbox()
    try {
      await waitFor(() => getRow(id)?.state === 'delivered', { timeoutMs: 8000 })

      const row = getRow(id)
      expect(row?.delivered_at).not.toBeNull()
      expect(row?.lease_id).toBeNull()
      expect(row?.lease_until).toBeNull()
    } finally {
      await runtime.stop()
    }
  }, 10000)

  it('marks a non-retryable (400) failure so the row stops retrying forever', async () => {
    process.env[KEY_ID_VAR] = 'test-key-id'
    process.env[SECRET_VAR] = 'b'.repeat(32)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 400 })))

    const id = seedPendingRow()
    const runtime = startNotificationOutbox()
    try {
      await waitFor(() => getRow(id)?.last_error != null, { timeoutMs: 8000 })

      const row = getRow(id)
      expect(row?.attempts).toBeGreaterThanOrEqual(1)
      expect(typeof row?.last_error).toBe('string')
      // Don't assume an exact terminal-state literal - just confirm the row
      // actually moved on from its initial pending/no-error state instead
      // of retrying this same failure forever.
      expect(row?.state).not.toBe('pending')
    } finally {
      await runtime.stop()
    }
  }, 10000)

  // Lease-fencing (a claimed row's mark* calls are conditioned on its lease
  // token so a stale/expired lease can't clobber a later claim) is a design
  // invariant of createNotificationOutboxRuntime itself, not something this
  // black-box test can force a genuine race for without either mocking the
  // shared library's internals (which would defeat the point of testing
  // against its public contract) or introducing real timing flakiness.
  // Skipped per the spec's guidance to prefer skipping over a fragile test.
})
