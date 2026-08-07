import { createNotificationOutboxRuntime, type NotificationOutboxRow } from '@zudar107/schloss-server-kit'
import { and, asc, eq, isNull, lte, or } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db } from '../../db/index.js'
import { notificationOutbox } from '../../db/schema.js'

const SOURCE = 'tafel'
const DEFAULT_GLOCKE_BASE_URL = 'http://glocke-backend:3004'

function eligibleAt(nowMs: number) {
  // Picks up both never-attempted rows (nextAttemptAt null/due) and rows
  // whose lease expired without a mark* call ever landing (a crash mid-
  // delivery) - either way, eligible for a fresh claim.
  return or(
    and(
      eq(notificationOutbox.state, 'pending'),
      or(isNull(notificationOutbox.nextAttemptAt), lte(notificationOutbox.nextAttemptAt, nowMs)),
    ),
    and(
      eq(notificationOutbox.state, 'inflight'),
      or(isNull(notificationOutbox.leaseUntil), lte(notificationOutbox.leaseUntil, nowMs)),
    ),
  )
}

// Wires Tafel's own notification_outbox table into the shared
// storage-agnostic delivery runtime (@zudar107/schloss-server-kit's
// createNotificationOutboxRuntime) - this file owns the SQLite
// transaction/lease-fencing policy the shared runtime deliberately stays
// agnostic to (dedupe itself is a separate concern, enforced at insert
// time by notifications/scanner.ts via the dedupe_key unique index).
// Returns a no-op stoppable stub (rather than throwing) when the HMAC
// credentials aren't configured, so a dev/test environment without
// Glocke set up doesn't crash on boot - events still get recorded, they
// just queue up undelivered until credentials are added.
export function startNotificationOutbox() {
  const keyId = process.env['TAFEL_TO_GLOCKE_HMAC_KEY_ID']
  const secret = process.env['TAFEL_TO_GLOCKE_HMAC_SECRET']
  if (!keyId || !secret) {
    console.warn('[Tafel] TAFEL_TO_GLOCKE_HMAC_KEY_ID/SECRET not configured - notification delivery disabled, events will queue undelivered')
    return { stop: async () => {} }
  }

  const runtime = createNotificationOutboxRuntime({
    source: SOURCE,
    keyId,
    secret,
    baseUrl: process.env['GLOCKE_BASE_URL'] ?? DEFAULT_GLOCKE_BASE_URL,
    leaseDurationMs: Number(process.env['GLOCKE_OUTBOX_LEASE_MS'] ?? 30_000),
    requestTimeoutMs: Number(process.env['GLOCKE_FETCH_TIMEOUT_MS'] ?? 10_000),
    pollIntervalMs: Number(process.env['GLOCKE_DISPATCH_INTERVAL_MS'] ?? 1_000),
    stopTimeoutMs: Number(process.env['GLOCKE_WORKER_STOP_TIMEOUT_MS'] ?? 5_000),
    maxAttempts: Number(process.env['GLOCKE_MAX_ATTEMPTS'] ?? 8),
    baseDelayMs: Number(process.env['GLOCKE_RETRY_BASE_DELAY_MS'] ?? 1_000),
    maxDelayMs: Number(process.env['GLOCKE_RETRY_MAX_DELAY_MS'] ?? 15 * 60_000),

    async claim({ now, leaseUntil }) {
      const nowMs = now.getTime()
      const leaseId = randomUUID()
      return db.transaction((tx) => {
        const row = tx.select().from(notificationOutbox)
          .where(eligibleAt(nowMs))
          .orderBy(asc(notificationOutbox.createdAt), asc(notificationOutbox.id))
          .limit(1)
          .get()
        if (!row) return null

        tx.update(notificationOutbox)
          .set({ state: 'inflight', leaseId, leaseUntil: leaseUntil.getTime() })
          .where(eq(notificationOutbox.id, row.id))
          .run()

        return {
          id: row.id,
          type: row.eventType,
          occurredAt: new Date(row.createdAt).toISOString(),
          correlationId: row.correlationId,
          payload: JSON.parse(row.payload) as unknown,
          attempts: row.attempts,
          leaseToken: leaseId,
        } satisfies NotificationOutboxRow
      })
    },

    async markDelivered({ id, leaseToken, deliveredAt }) {
      const result = db.update(notificationOutbox).set({
        state: 'delivered', leaseId: null, leaseUntil: null,
        deliveredAt: deliveredAt.getTime(), lastError: null,
      }).where(and(eq(notificationOutbox.id, id), eq(notificationOutbox.leaseId, leaseToken))).run()
      return result.changes > 0
    },

    async markRetry({ id, leaseToken, attempts, nextAttemptAt, error }) {
      const result = db.update(notificationOutbox).set({
        state: 'pending', attempts, nextAttemptAt: nextAttemptAt.getTime(),
        leaseId: null, leaseUntil: null, lastError: error,
      }).where(and(eq(notificationOutbox.id, id), eq(notificationOutbox.leaseId, leaseToken))).run()
      return result.changes > 0
    },

    async markPermanent({ id, leaseToken, attempts, error }) {
      const result = db.update(notificationOutbox).set({
        state: 'permanent', attempts, nextAttemptAt: null,
        leaseId: null, leaseUntil: null, lastError: error,
      }).where(and(eq(notificationOutbox.id, id), eq(notificationOutbox.leaseId, leaseToken))).run()
      return result.changes > 0
    },
  })

  runtime.start()
  return runtime
}
