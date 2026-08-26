// Glocke has no launcher card of its own here - Tafel isn't Schloss - but
// the header notification bell still needs to know whether Glocke is
// actually deployed, since `glockeUrl` always falls back to a working dev
// default even when GLOCKE_URL is unset in production.
export interface RuntimeConfigServices {
  glocke: boolean
}

export interface RuntimeConfig {
  schemaVersion: 1
  schlusselUrl: string
  schlossUrl: string
  glockeUrl: string
  services: RuntimeConfigServices
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
  services: { glocke: true },
}

// Missing or non-boolean flags default to enabled (true) - a deployment
// that hasn't started emitting `services` yet (or a hand-edited config.js)
// should keep showing the bell, matching behavior before this field
// existed, rather than hiding it for nobody having asked to disable Glocke.
function readServices(value: unknown): RuntimeConfigServices {
  const source = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const glocke = source.glocke
  return { glocke: typeof glocke === 'boolean' ? glocke : true }
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
    services: readServices(raw?.services),
  }
}
