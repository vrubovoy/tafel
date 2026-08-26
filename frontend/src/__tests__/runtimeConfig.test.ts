import { afterEach, describe, expect, it } from 'vitest'
import { getRuntimeConfig } from '../lib/runtimeConfig'

afterEach(() => {
  delete window.__HOF_CONFIG__
})

describe('runtime config', () => {
  it('uses localhost defaults for missing and blank values', () => {
    window.__HOF_CONFIG__ = { schemaVersion: 1, schlusselUrl: '  ' }
    expect(getRuntimeConfig()).toEqual({
      schemaVersion: 1,
      schlusselUrl: 'http://localhost:4001',
      schlossUrl: 'http://localhost:3000',
      glockeUrl: 'http://localhost:5177',
    })
  })

  it('normalizes origins and reads changes on demand', () => {
    window.__HOF_CONFIG__ = { schemaVersion: 1, glockeUrl: 'https://glocke.example/' }
    expect(getRuntimeConfig().glockeUrl).toBe('https://glocke.example')
    window.__HOF_CONFIG__.glockeUrl = 'http://glocke.internal'
    expect(getRuntimeConfig().glockeUrl).toBe('http://glocke.internal')
  })

  it.each(['ftp://example.com', 'https://user@example.com', 'https://example.com/path', 'https://example.com?q=1', 'not a url'])(
    'rejects malformed explicit origin %s',
    (glockeUrl) => {
      window.__HOF_CONFIG__ = { schemaVersion: 1, glockeUrl }
      expect(() => getRuntimeConfig()).toThrow(/glockeUrl/)
    },
  )

  it('rejects unsupported explicit schema versions', () => {
    window.__HOF_CONFIG__ = { schemaVersion: 2 }
    expect(() => getRuntimeConfig()).toThrow(/schemaVersion/)
  })
})
