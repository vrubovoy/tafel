import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/index.js', async () => await import('./helpers/db.js'))

import { startNotificationOutbox } from '../features/notifications/outbox.js'
import { sqlite } from './helpers/db.js'

const KEY_ID_VAR = 'TAFEL_TO_GLOCKE_HMAC_KEY_ID'
const SECRET_VAR = 'TAFEL_TO_GLOCKE_HMAC_SECRET'
const CONFIG_VARS = [
  KEY_ID_VAR,
  SECRET_VAR,
  'GLOCKE_BASE_URL',
  'GLOCKE_OUTBOX_LEASE_MS',
  'GLOCKE_FETCH_TIMEOUT_MS',
  'GLOCKE_DISPATCH_INTERVAL_MS',
  'GLOCKE_WORKER_STOP_TIMEOUT_MS',
  'GLOCKE_MAX_ATTEMPTS',
  'GLOCKE_RETRY_BASE_DELAY_MS',
  'GLOCKE_RETRY_MAX_DELAY_MS',
  'GLOCKE_OUTBOX_RETENTION_MS',
] as const

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
  permanent_at: number | null
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

function seedRow(options: {
  id: string
  state: string
  createdAt: number
  deliveredAt?: number | null
  permanentAt?: number | null
  nextAttemptAt?: number | null
  leaseId?: string | null
  leaseUntil?: number | null
}) {
  sqlite.prepare(`
    INSERT INTO notification_outbox
      (id, event_type, user_id, payload, correlation_id, dedupe_key, state, created_at,
       attempts, next_attempt_at, lease_id, lease_until, delivered_at, permanent_at)
    VALUES (?, 'tafel.task.due.v1', 'user-1', '{}', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
  `).run(
    options.id,
    options.id,
    `dedupe-${options.id}`,
    options.state,
    options.createdAt,
    options.nextAttemptAt ?? null,
    options.leaseId ?? null,
    options.leaseUntil ?? null,
    options.deliveredAt ?? null,
    options.permanentAt ?? null,
  )
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
  let savedConfig: Record<string, string | undefined>

  beforeEach(() => {
    savedConfig = Object.fromEntries(CONFIG_VARS.map((name) => [name, process.env[name]]))
    for (const name of CONFIG_VARS) delete process.env[name]
    sqlite.exec('DELETE FROM notification_outbox')
  })

  afterEach(() => {
    for (const name of CONFIG_VARS) {
      const value = savedConfig[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    vi.unstubAllGlobals()
    vi.useRealTimers()
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
      expect(row?.permanent_at).not.toBeNull()
      // Don't assume an exact terminal-state literal - just confirm the row
      // actually moved on from its initial pending/no-error state instead
      // of retrying this same failure forever.
      expect(row?.state).not.toBe('pending')
    } finally {
      await runtime.stop()
    }
  }, 10000)

  it.each([
    ['key ID only', { [KEY_ID_VAR]: 'test-key-id' }],
    ['secret only', { [SECRET_VAR]: 'd'.repeat(32) }],
  ])('rejects partially configured credentials with %s instead of silently disabling delivery', (_case, values) => {
    Object.assign(process.env, values)

    expect(() => startNotificationOutbox()).toThrow(/credential|secret/i)
  })

  it.each(['0', '-1', '1.5', 'NaN', '2147483648'])(
    'rejects retention interval %s before starting the delivery worker',
    async (value) => {
      process.env[KEY_ID_VAR] = 'test-key-id'
      process.env[SECRET_VAR] = 'e'.repeat(32)
      process.env['GLOCKE_OUTBOX_RETENTION_MS'] = value
      let runtime: ReturnType<typeof startNotificationOutbox> | undefined

      try {
        expect(() => { runtime = startNotificationOutbox() }).toThrow(/GLOCKE_OUTBOX_RETENTION_MS/)
      } finally {
        await runtime?.stop()
      }
    },
  )

  it('removes only delivered and permanent rows older than retention', async () => {
    process.env[KEY_ID_VAR] = 'test-key-id'
    process.env[SECRET_VAR] = 'c'.repeat(32)
    process.env['GLOCKE_OUTBOX_RETENTION_MS'] = String(60 * 60_000)
    const now = Date.now()
    const old = now - 2 * 60 * 60_000
    const fresh = now - 30 * 60_000
    seedRow({ id: 'old-delivered', state: 'delivered', createdAt: old, deliveredAt: old })
    seedRow({ id: 'old-permanent', state: 'permanent', createdAt: old, permanentAt: old })
    seedRow({ id: 'fresh-delivered', state: 'delivered', createdAt: old, deliveredAt: fresh })
    seedRow({ id: 'fresh-permanent', state: 'permanent', createdAt: old, permanentAt: fresh })
    seedRow({ id: 'untimestamped-permanent', state: 'permanent', createdAt: old })
    seedRow({ id: 'old-pending', state: 'pending', createdAt: old, nextAttemptAt: now + 60_000 })
    seedRow({ id: 'old-inflight', state: 'inflight', createdAt: old, leaseId: 'active', leaseUntil: now + 60_000 })
    seedRow({ id: 'old-new', state: 'new', createdAt: old })
    vi.stubGlobal('fetch', vi.fn())

    const runtime = startNotificationOutbox()
    try {
      const retainedIds = (sqlite.prepare('SELECT id FROM notification_outbox ORDER BY id').all() as Array<{ id: string }>)
        .map(({ id }) => id)
      expect(retainedIds).toEqual([
        'fresh-delivered',
        'fresh-permanent',
        'old-inflight',
        'old-new',
        'old-pending',
        'untimestamped-permanent',
      ])
    } finally {
      await runtime.stop()
    }
  })

  it('continues bounded cleanup without credentials and clears its timer on stop', async () => {
    vi.useFakeTimers()
    process.env['GLOCKE_OUTBOX_RETENTION_MS'] = String(60 * 60_000)
    const old = Date.now() - 2 * 60 * 60_000
    for (let index = 0; index < 201; index += 1) {
      seedRow({
        id: `old-${String(index).padStart(3, '0')}`,
        state: 'permanent',
        createdAt: old,
        permanentAt: old,
      })
    }

    const runtime = startNotificationOutbox()
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get()).toEqual({ count: 101 })

    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000)
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM notification_outbox').get()).toEqual({ count: 0 })

    await runtime.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  // Lease-fencing (a claimed row's mark* calls are conditioned on its lease
  // token so a stale/expired lease can't clobber a later claim) is a design
  // invariant of createNotificationOutboxRuntime itself, not something this
  // black-box test can force a genuine race for without either mocking the
  // shared library's internals (which would defeat the point of testing
  // against its public contract) or introducing real timing flakiness.
  // Skipped per the spec's guidance to prefer skipping over a fragile test.
})
