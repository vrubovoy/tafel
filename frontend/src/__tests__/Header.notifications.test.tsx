import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AuthUser } from '../hooks/useAuth'

const glockeUrl = 'https://glocke.example.com'
const notificationUrl = `${glockeUrl}/notifications`
const unreadUrl = `${glockeUrl}/backend/notifications/unread-count`
const mockUser: AuthUser = { id: '1', email: 'user@example.com', name: 'User', role: 'user' }

function unreadResponse(count: number): Response {
  return new Response(JSON.stringify({ count }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function profileResponse(): Response {
  return new Response(JSON.stringify({ avatarDataUrl: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

// The Header now also fires an independent GET .../auth/profile fetch
// (useAvatarUrl) alongside the unread-count one - route by URL so both
// get their own fresh Response (a single shared Response instance's body
// can only be read once, which broke when two hooks both tried to read
// the same mocked instance) without changing what each test is actually
// asserting about the unread-count endpoint specifically.
function routedFetch(unreadHandler: () => Response | Promise<Response>): ReturnType<typeof vi.fn> {
  return vi.fn((input: RequestInfo | URL) => {
    if (String(input).includes('/auth/profile')) return Promise.resolve(profileResponse())
    return Promise.resolve(unreadHandler())
  })
}

async function renderHeader(options: {
  user?: AuthUser | null
  token?: string | null
  onLogout?: () => void | Promise<void>
  glockeOrigin?: string
} = {}) {
  vi.resetModules()
  window.__HOF_CONFIG__ = { schemaVersion: 1, glockeUrl: options.glockeOrigin ?? glockeUrl }
  const [{ Header }, { setAccessToken }] = await Promise.all([
    import('../components/Header'),
    import('../lib/api'),
  ])
  setAccessToken(options.token === undefined ? 'memory-token' : options.token)
  render(
    <Header
      user={options.user === undefined ? mockUser : options.user}
      onLogout={options.onLogout ?? vi.fn()}
      onOpenMobileMenu={vi.fn()}
    />,
  )
}

function notificationLink(): HTMLAnchorElement {
  return screen.getByRole('link', { name: /уведомления|notifications/i }) as HTMLAnchorElement
}

afterEach(() => {
  cleanup()
  delete window.__HOF_CONFIG__
  vi.unstubAllGlobals()
})

describe('authenticated Header Glocke bell', () => {
  it('links the shared bell to the configured Glocke origin', async () => {
    vi.stubGlobal('fetch', routedFetch(() => unreadResponse(0)))
    await renderHeader()

    expect(await screen.findByRole('link', { name: 'Уведомления: непрочитанных нет' })).toHaveAttribute('href', notificationUrl)
  })

  it.each([
    { count: 0, label: null },
    { count: 7, label: '7' },
    { count: 100, label: '99+' },
  ])('renders the unread count state for $count', async ({ count, label }) => {
    vi.stubGlobal('fetch', routedFetch(() => unreadResponse(count)))
    await renderHeader()
    const accessibleName = count === 0
      ? 'Уведомления: непрочитанных нет'
      : `Уведомления: непрочитанных — ${count}`
    const bell = await screen.findByRole('link', { name: accessibleName })

    if (label === null) expect(bell).not.toHaveTextContent(/\d/)
    else expect(within(bell).getByText(label)).toBeInTheDocument()
  })

  it('does not request unread state or render the bell before authentication', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await renderHeader({ user: null })

    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: /уведомления|notifications/i })).not.toBeInTheDocument()
  })

  it('uses the existing in-memory token only as a Bearer Authorization header', async () => {
    const fetchMock = routedFetch(() => unreadResponse(3))
    vi.stubGlobal('fetch', fetchMock)
    await renderHeader({ token: 'memory-token' })

    await screen.findByRole('link', { name: 'Уведомления: непрочитанных — 3' })
    const [input, init] = fetchMock.mock.calls.find(([url]) => String(url) === unreadUrl) as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(input).toBe(unreadUrl)
    expect(input).not.toContain('memory-token')
    expect(headers.get('Authorization')).toBe('Bearer memory-token')
    expect(init.body).toBeUndefined()
    expect(init.credentials).toBe('omit')
  })

  it.each([
    ['network failure', () => Promise.reject(new Error('offline'))],
    ['HTTP failure', () => Promise.resolve(new Response(null, { status: 503 }))],
  ])('keeps Glocke navigation available after a %s', async (_name, response) => {
    vi.stubGlobal('fetch', vi.fn(response))
    await renderHeader()

    expect(await screen.findByRole('link', { name: 'Уведомления: число непрочитанных недоступно' })).toHaveAttribute('href', notificationUrl)
  })

  it('aborts the unread request and disables the bell when logout starts', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_input: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => undefined)
    }))
    const onLogout = vi.fn(() => new Promise<void>(() => undefined))
    await renderHeader({ onLogout })
    await waitFor(() => expect(signal).toBeDefined())
    notificationLink()

    await userEvent.click(screen.getByRole('button', { name: /выйти/i }))

    expect(onLogout).toHaveBeenCalledOnce()
    expect(signal?.aborted).toBe(true)
    const activeBell = screen.queryByRole('link', { name: /уведомления|notifications/i })
    expect(activeBell === null || activeBell.getAttribute('aria-disabled') === 'true').toBe(true)
  })
})
