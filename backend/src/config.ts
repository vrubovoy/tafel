const MAX_INTERVAL_MS = 2_147_483_647
const DEFAULT_OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60_000

export function positiveIntervalMs(name: string, fallback: number): number {
  const raw = process.env[name]
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isInteger(value) || value <= 0 || value > MAX_INTERVAL_MS) {
    throw new Error(`${name} must be a positive integer no greater than ${MAX_INTERVAL_MS}`)
  }
  return value
}

export function notificationOutboxStartupConfig() {
  const keyId = process.env['TAFEL_TO_GLOCKE_HMAC_KEY_ID']
  const secret = process.env['TAFEL_TO_GLOCKE_HMAC_SECRET']
  const retentionMs = positiveIntervalMs('GLOCKE_OUTBOX_RETENTION_MS', DEFAULT_OUTBOX_RETENTION_MS)
  if (Boolean(keyId) !== Boolean(secret)) {
    throw new Error('Tafel-to-Glocke HMAC credentials require both key ID and secret')
  }
  return { keyId, secret, retentionMs }
}
