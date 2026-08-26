export interface RuntimeConfig {
  schemaVersion: 1
  schlusselUrl: string
  schlossUrl: string
  glockeUrl: string
}

type RawRuntimeConfig = Partial<Record<keyof RuntimeConfig, unknown>>

declare global {
  interface Window {
    __HOF_CONFIG__?: RawRuntimeConfig
  }
}

const defaults: RuntimeConfig = {
  schemaVersion: 1,
  schlusselUrl: 'http://localhost:4001',
  schlossUrl: 'http://localhost:3000',
  glockeUrl: 'http://localhost:5177',
}

function readOrigin(value: unknown, fallback: string, field: string): string {
  if (value === undefined || (typeof value === 'string' && value.trim() === '')) return fallback
  if (typeof value !== 'string') throw new Error(`Invalid runtime config ${field}: expected an HTTP(S) origin`)

  try {
    const url = new URL(value.trim())
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username !== ''
      || url.password !== ''
      || url.pathname !== '/'
      || url.search !== ''
      || url.hash !== ''
    ) throw new Error('not an origin')
    return url.origin
  } catch {
    throw new Error(`Invalid runtime config ${field}: expected an HTTP(S) origin`)
  }
}

export function getRuntimeConfig(): RuntimeConfig {
  const raw = window.__HOF_CONFIG__
  if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) {
    throw new Error('Invalid runtime config: expected an object')
  }
  if (raw?.schemaVersion !== undefined && raw.schemaVersion !== 1) {
    throw new Error('Invalid runtime config schemaVersion: expected 1')
  }

  return {
    schemaVersion: 1,
    schlusselUrl: readOrigin(raw?.schlusselUrl, defaults.schlusselUrl, 'schlusselUrl'),
    schlossUrl: readOrigin(raw?.schlossUrl, defaults.schlossUrl, 'schlossUrl'),
    glockeUrl: readOrigin(raw?.glockeUrl, defaults.glockeUrl, 'glockeUrl'),
  }
}
