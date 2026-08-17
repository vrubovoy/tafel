import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lifecycle = vi.hoisted(() => ({
  close: vi.fn(),
  stop: vi.fn(),
  scan: vi.fn(),
  startOutbox: vi.fn(),
  serve: vi.fn(),
}))

vi.mock('@hono/node-server', () => ({ serve: lifecycle.serve }))
vi.mock('drizzle-orm/better-sqlite3/migrator', () => ({ migrate: vi.fn() }))
vi.mock('../db/index.js', () => ({ db: {} }))
vi.mock('../features/notifications/outbox.js', () => ({ startNotificationOutbox: lifecycle.startOutbox }))
vi.mock('../features/notifications/scanner.js', () => ({ scanTaskDueNotifications: lifecycle.scan }))
vi.mock('../middleware/auth.js', () => ({ requireAuth: vi.fn(), requireAdmin: vi.fn() }))
vi.mock('../features/projects/router.js', async () => ({ projectsRouter: new (await import('hono')).Hono() }))
vi.mock('../features/statuses/router.js', async () => ({ statusesRouter: new (await import('hono')).Hono() }))
vi.mock('../features/tasks/router.js', async () => ({ tasksRouter: new (await import('hono')).Hono() }))
vi.mock('../features/stats/router.js', async () => ({ statsRouter: new (await import('hono')).Hono() }))
vi.mock('../features/users/router.js', async () => ({ usersRouter: new (await import('hono')).Hono() }))
vi.mock('../features/exports/router.js', async () => ({ exportsRouter: new (await import('hono')).Hono() }))
vi.mock('../openapi.js', () => ({ openApiDocument: {} }))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('backend lifecycle', () => {
  const savedScanInterval = process.env['TAFEL_DUE_SCAN_INTERVAL_MS']

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    lifecycle.close.mockReset()
    lifecycle.stop.mockReset()
    lifecycle.scan.mockReset().mockResolvedValue(0)
    lifecycle.startOutbox.mockReset().mockReturnValue({ stop: lifecycle.stop })
    lifecycle.serve.mockReset().mockReturnValue({ close: lifecycle.close })
    process.env['TAFEL_DUE_SCAN_INTERVAL_MS'] = '3600000'
    vi.spyOn(process, 'once').mockImplementation(() => process)
  })

  afterEach(() => {
    if (savedScanInterval === undefined) delete process.env['TAFEL_DUE_SCAN_INTERVAL_MS']
    else process.env['TAFEL_DUE_SCAN_INTERVAL_MS'] = savedScanInterval
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each(['0', '-1', '1.5', 'NaN', '2147483648'])(
    'rejects scan interval %s before starting workers',
    async (value) => {
      process.env['TAFEL_DUE_SCAN_INTERVAL_MS'] = value

      await expect(import('../index.js')).rejects.toThrow(/TAFEL_DUE_SCAN_INTERVAL_MS/)
      expect(lifecycle.serve).not.toHaveBeenCalled()
      expect(lifecycle.startOutbox).not.toHaveBeenCalled()
      expect(lifecycle.scan).not.toHaveBeenCalled()
    },
  )

  it.each(['active scan', 'HTTP server', 'notification dispatcher'] as const)(
    'waits for the %s during shutdown',
    async (pendingComponent) => {
      const scanFinished = deferred()
      const serverClosed = deferred()
      const dispatcherStopped = deferred()
      lifecycle.scan.mockReturnValue(scanFinished.promise)
      lifecycle.close.mockImplementation((callback?: () => void) => {
        void serverClosed.promise.then(() => callback?.())
      })
      lifecycle.stop.mockReturnValue(dispatcherStopped.promise)
      const backend = await import('../index.js')
      const shutdown = (backend as unknown as { shutdown?: () => Promise<void> }).shutdown
      expect(shutdown).toBeTypeOf('function')

      let settled = false
      const result = shutdown!().then(() => { settled = true })
      if (pendingComponent !== 'active scan') scanFinished.resolve()
      if (pendingComponent !== 'HTTP server') serverClosed.resolve()
      if (pendingComponent !== 'notification dispatcher') dispatcherStopped.resolve()
      await Promise.resolve()
      await Promise.resolve()
      expect(settled).toBe(false)

      if (pendingComponent === 'active scan') scanFinished.resolve()
      if (pendingComponent === 'HTTP server') serverClosed.resolve()
      if (pendingComponent === 'notification dispatcher') dispatcherStopped.resolve()
      await expect(result).resolves.toBeUndefined()
      expect(lifecycle.close).toHaveBeenCalledOnce()
      expect(lifecycle.stop).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    },
  )
})
