import { useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import {
  List, Calendar, Kanban, FolderKanban, BarChart3, Settings,
  LogOut, X, FileCode2, HelpCircle
} from 'lucide-react'
import { Toast, ThemeToggle, useSidebarWidth } from '@zudar107/schloss-ui'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { buildSchluesselLogoutUrl, buildSchluesselAccountUrl } from '../lib/authRedirect'
import { Footer } from './Footer'
import { Header } from './Header'

const SIDEBAR_WIDTH_STORAGE_KEY = 'tafel-sidebar-width'

const NAV_ITEMS = [
  { to: '/tasks',    icon: <List size={18} />,         label: 'Список' },
  { to: '/kanban',   icon: <Kanban size={18} />,       label: 'Канбан' },
  { to: '/calendar', icon: <Calendar size={18} />,     label: 'Календарь' },
  { to: '/projects', icon: <FolderKanban size={18} />, label: 'Проекты' },
  { to: '/stats',    icon: <BarChart3 size={18} />,    label: 'Статистика' },
  { to: '/settings', icon: <Settings size={18} />,     label: 'Настройки' },
  { to: '/help',     icon: <HelpCircle size={18} />,   label: 'Справка' },
]

// Admin-only, appended rather than baked into NAV_ITEMS - /docs 403s the
// API request for anyone else, so hiding the link avoids a dead-end click.
const DOCS_NAV_ITEM = { to: '/docs', icon: <FileCode2 size={18} />, label: 'Документация API' }

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const toast = useToast()
  const { pathname } = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const { width: sidebarWidth, collapsed, dragging, toggleCollapsed, startDrag } = useSidebarWidth({
    storageKey: SIDEBAR_WIDTH_STORAGE_KEY,
  })

  const navItems = user?.role === 'admin' ? [...NAV_ITEMS, DOCS_NAV_ITEM] : NAV_ITEMS

  async function handleLogout() {
    try {
      await logout()
      window.location.href = buildSchluesselLogoutUrl()
    } catch (err) {
      // Without this, a failed logout silently did nothing visible - the
      // button looked broken rather than surfacing what went wrong.
      console.error('Logout failed', err)
      toast.showError('Не удалось выйти. Попробуйте ещё раз.')
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'var(--bg-overlay)', zIndex: 40 }}
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar - clicking anywhere on it that isn't a nav link/button
          (i.e. empty space: the logo area, gaps around the nav list, the
          padding around the bottom actions) toggles collapsed/expanded.
          Each interactive child below stops the click from bubbling here,
          so clicking an actual control never also toggles the sidebar. */}
      <aside
        onClick={toggleCollapsed}
        style={{
          width: sidebarWidth,
          background: 'var(--sidebar-bg)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          transition: dragging ? 'none' : 'width 200ms ease',
          position: 'relative',
          zIndex: 50,
          cursor: 'pointer',
        }}
        className="hidden-mobile"
      >
        {/* Resize handle - drag anywhere along the sidebar's right edge to
            resize continuously; dragging past the collapse threshold
            snaps shut. Wider than the border itself (10px) so it's easy
            to grab. */}
        <div
          onMouseDown={startDrag}
          style={{
            position: 'absolute', top: 0, bottom: 0, right: -5, width: 10,
            cursor: 'col-resize', zIndex: 61,
          }}
        />
        {/* Logo */}
        <div style={{
          height: 56, display: 'flex', alignItems: 'center',
          padding: collapsed ? '0 0 0 18px' : '0 1rem',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          gap: '0.625rem',
          overflow: 'hidden',
        }}>
          <div style={{
            width: 28, height: 28, background: 'var(--sidebar-accent)',
            borderRadius: 8, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="4" height="18" rx="1.5" fill="white" />
              <rect x="10" y="3" width="4" height="11" rx="1.5" fill="white" fillOpacity="0.55" />
              <rect x="17" y="3" width="4" height="18" rx="1.5" fill="white" />
            </svg>
          </div>
          {!collapsed && (
            <span style={{ color: 'white', fontWeight: 700, fontSize: '0.9375rem', letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
              Tafel
            </span>
          )}
        </div>

        {/* Nav - minHeight: 0 for the same reason as <main> below (a flex
            item won't scroll within its space without it, growing the
            sidebar past the viewport instead once there are enough
            nav items). */}
        <nav style={{ flex: 1, minHeight: 0, padding: '0.75rem 0.5rem', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          {navItems.map(({ to, icon, label }) => {
            const active = pathname.startsWith(to)
            return (
              <Link
                key={to}
                to={to}
                onClick={(e) => e.stopPropagation()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.625rem',
                  padding: collapsed ? '0.5rem' : '0.5rem 0.75rem',
                  borderRadius: 8,
                  textDecoration: 'none',
                  color: active ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)',
                  background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
                  fontSize: '0.875rem',
                  fontWeight: active ? 600 : 400,
                  transition: 'background 150ms, color 150ms',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = 'transparent'
                }}
              >
                <span style={{ flexShrink: 0 }}>{icon}</span>
                {!collapsed && label}
              </Link>
            )
          })}
        </nav>

        {/* Bottom actions */}
        <div style={{ padding: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {user && (
            <div
              onClick={(e) => {
                e.stopPropagation()
                window.location.href = buildSchluesselAccountUrl(window.location.pathname)
              }}
              title="Настройки аккаунта"
              style={{
                display: 'flex', alignItems: 'center', gap: '0.625rem',
                padding: collapsed ? '0.5rem' : '0.5rem 0.75rem',
                marginBottom: 4,
                cursor: 'pointer', borderRadius: 8,
              }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: 'var(--sidebar-accent)', color: 'white',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.75rem', fontWeight: 700,
              }}>
                {user.name.charAt(0).toUpperCase()}
              </div>
              {!collapsed && (
                <div style={{ overflow: 'hidden', minWidth: 0 }}>
                  <div style={{
                    color: 'var(--sidebar-text-active)', fontSize: '0.8125rem', fontWeight: 600,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {user.name}
                  </div>
                  <div style={{
                    color: 'var(--sidebar-text)', fontSize: '0.6875rem',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {user.email}
                  </div>
                </div>
              )}
            </div>
          )}
          <ThemeToggle
            align="left"
            trigger={({ icon, onClick }) => (
              <button
                onClick={(e) => { e.stopPropagation(); onClick() }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.625rem',
                  padding: collapsed ? '0.5rem' : '0.5rem 0.75rem',
                  borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: 'transparent', color: 'var(--sidebar-text)',
                  fontSize: '0.8125rem', transition: 'background 150ms',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  width: '100%',
                }}
              >
                {icon}
                {!collapsed && <span>Тема</span>}
              </button>
            )}
          />
          {user && (
            <button
              onClick={async (e) => { e.stopPropagation(); await handleLogout() }}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.625rem',
                padding: collapsed ? '0.5rem' : '0.5rem 0.75rem',
                borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'transparent', color: 'var(--sidebar-text)',
                fontSize: '0.8125rem', transition: 'background 150ms',
                justifyContent: collapsed ? 'center' : 'flex-start',
                width: '100%',
              }}
            >
              <LogOut size={15} />
              {!collapsed && 'Выйти'}
            </button>
          )}
        </div>
      </aside>

      {/* Mobile sidebar */}
      <aside
        style={{
          position: 'fixed', left: mobileOpen ? 0 : -260, top: 0, bottom: 0,
          width: 260, background: 'var(--sidebar-bg)',
          zIndex: 50, transition: 'left 250ms ease',
          display: 'flex', flexDirection: 'column',
        }}
        className="show-mobile"
      >
        <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ color: 'white', fontWeight: 700, fontSize: '0.9375rem' }}>Tafel</span>
          <button onClick={() => setMobileOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--sidebar-text)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
        <nav style={{ flex: 1, padding: '0.75rem 0.5rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {navItems.map(({ to, icon, label }) => {
            const active = pathname.startsWith(to)
            return (
              <Link
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.625rem',
                  padding: '0.5rem 0.75rem', borderRadius: 8, textDecoration: 'none',
                  color: active ? 'white' : 'var(--sidebar-text)',
                  background: active ? 'rgba(255,255,255,0.1)' : 'transparent',
                  fontSize: '0.875rem', fontWeight: active ? 600 : 400,
                }}
              >
                {icon}{label}
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Header user={user} onLogout={handleLogout} onOpenMobileMenu={() => setMobileOpen(true)} />

        {/* minHeight: 0 is required here - a flex item defaults to
            min-height: auto, which lets it grow to fit tall content
            instead of scrolling within its allotted space. Without it,
            long pages push past the viewport and the Footer below gets
            clipped by the parent's overflow: hidden - not just "needs
            scrolling", genuinely unreachable. */}
        <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1.5rem' }}>
          {children}
        </main>

        <Footer />
      </div>

      {toast.toast && (
        <Toast open variant={toast.toast.variant} message={toast.toast.message} onDismiss={toast.dismiss} />
      )}
    </div>
  )
}
