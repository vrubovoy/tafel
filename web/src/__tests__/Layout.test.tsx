import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Layout } from '../components/Layout'
import { AuthContext } from '../hooks/useAuth'
import type { AuthUser } from '../hooks/useAuth'

// ---------------------------------------------------------------------------
// Mock TanStack Router — same mechanical pattern as kuvert's Layout.test.tsx
// / sidebarResize.test.tsx, extended with useSearch since other Tafel pages
// use it (harmless to include even if Layout itself doesn't).
// ---------------------------------------------------------------------------
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/kanban' }),
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>{children}</a>
  ),
}))

const regularUser: AuthUser = { id: '1', email: 'u@u.com', name: 'User', role: 'user' }
const adminUser: AuthUser = { id: '2', email: 'admin@u.com', name: 'Admin', role: 'admin' }

function renderLayout(user: AuthUser | null) {
  return render(
    <AuthContext.Provider value={{ user, loading: false, logout: vi.fn(), setUser: vi.fn() }}>
      <Layout>content</Layout>
    </AuthContext.Provider>,
  )
}

// Finds a nav entry (link, matched by its `to`/href referencing the given
// route) for a given route path, tolerant of how exactly the label is
// spelled since that's implementation copy the spec doesn't pin down.
function hasNavLinkTo(routeFragment: string): boolean {
  const links = screen.queryAllByRole('link') as HTMLAnchorElement[]
  return links.some((link) => (link.getAttribute('href') ?? '').includes(routeFragment))
}

describe('Layout navigation entries', () => {
  it('renders a nav entry for kanban, tasks, calendar, projects, stats, settings, and help', () => {
    renderLayout(regularUser)

    expect(hasNavLinkTo('/kanban')).toBe(true)
    expect(hasNavLinkTo('/tasks')).toBe(true)
    expect(hasNavLinkTo('/calendar')).toBe(true)
    expect(hasNavLinkTo('/projects')).toBe(true)
    expect(hasNavLinkTo('/stats')).toBe(true)
    expect(hasNavLinkTo('/settings')).toBe(true)
    expect(hasNavLinkTo('/help')).toBe(true)
  })

  it('does not crash and still renders the nav when there is no user', () => {
    expect(() => renderLayout(null)).not.toThrow()
    expect(hasNavLinkTo('/kanban')).toBe(true)
  })
})

describe('Layout admin-only docs nav entry', () => {
  it('shows an additional nav entry referencing /docs for an admin user', () => {
    renderLayout(adminUser)
    expect(hasNavLinkTo('/docs')).toBe(true)
  })

  it('does not show a /docs nav entry for a non-admin user', () => {
    renderLayout(regularUser)
    expect(hasNavLinkTo('/docs')).toBe(false)
  })
})
