import { readFileSync, statSync } from 'node:fs'

const MAX_INTERVAL_MS = 2_147_483_647
const DEFAULT_OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60_000
const MAX_SECRET_FILE_BYTES = 64 * 1024

export function resolveSecret(name: string): string | undefined {
  const direct = process.env[name]
  const fileName = `${name}_FILE`
  const path = process.env[fileName]
  const hasDirect = direct !== undefined && direct !== ''
  const hasFile = path !== undefined && path !== ''
  if (hasDirect && hasFile) throw new Error(`${name} and ${fileName} are mutually exclusive`)
  let value: string | undefined
  if (hasDirect) value = direct
  if (hasFile) {
    const stat = statSync(path)
    if (!stat.isFile()) throw new Error(`${fileName} must reference a regular file`)
    if (stat.size > MAX_SECRET_FILE_BYTES) throw new Error(`${fileName} must not exceed 64 KiB`)
    try {
      value = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path))
    } catch (error) {
      if (error instanceof TypeError) throw new Error(`${fileName} must contain valid UTF-8`)
      throw error
    }
    if (value.endsWith('\r\n')) value = value.slice(0, -2)
    else if (value.endsWith('\n')) value = value.slice(0, -1)
  }
  if (value?.includes('\0')) throw new Error(`${name} must not contain NUL bytes`)
  if (hasFile && value === '') throw new Error(`${fileName} must not contain an empty secret`)
  return value
}

export function positiveIntervalMs(name: string, fallback: number): number {
  const raw = process.env[name]
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isInteger(value) || value <= 0 || value > MAX_INTERVAL_MS) {
    throw new Error(`${name} must be a positive integer no greater than ${MAX_INTERVAL_MS}`)
  }
  return value
}

export function notificationOutboxStartupConfig() {
  const keyId = process.env['TAFEL_TO_GLOCKE_HMAC_KEY_ID'] || undefined
  const secret = resolveSecret('TAFEL_TO_GLOCKE_HMAC_SECRET')
  const retentionMs = positiveIntervalMs('GLOCKE_OUTBOX_RETENTION_MS', DEFAULT_OUTBOX_RETENTION_MS)
  if (Boolean(keyId) !== Boolean(secret)) {
    throw new Error('Tafel-to-Glocke HMAC credentials require both key ID and secret')
  }
  return { keyId, secret, retentionMs }
}
