import { useState } from 'react'
import { Menu } from 'lucide-react'
import {
  Header as SharedHeader,
  ThemeToggle,
  useAvatarUrl,
  useUnreadNotifications,
} from '@zudar107/schloss-ui'
import { buildSchluesselAccountUrl } from '../lib/authRedirect'
import type { AuthUser } from '../hooks/useAuth'
import { apiClient } from '../lib/api'
import { getRuntimeConfig } from '../lib/runtimeConfig'

// Where "На главную" links back to (schloss) - separate from
// schlusselUrl, which points the other way (to the login page).

interface HeaderProps {
  user: AuthUser | null
  onLogout: () => void | Promise<void>
  onOpenMobileMenu: () => void
}

// Always visible (desktop and mobile) - the sidebar (which carries
// identity/settings/logout) is hidden below the mobile breakpoint, so
// this sits alongside its own controls rather than replacing them.
export function Header({ user, onLogout, onOpenMobileMenu }: HeaderProps) {
  const [loggingOut, setLoggingOut] = useState(false)
  const { schlossUrl, glockeUrl, schlusselUrl, services } = getRuntimeConfig()
  const notificationState = useUnreadNotifications({
    glockeOrigin: glockeUrl,
    userId: loggingOut || !services.glocke ? null : user?.id ?? null,
    apiClient,
  })
  const avatarUrl = useAvatarUrl({
    schluesselOrigin: schlusselUrl,
    userId: loggingOut ? null : user?.id ?? null,
    apiClient,
  })

  function handleLogout() {
    setLoggingOut(true)
    void Promise.resolve(onLogout()).catch(() => setLoggingOut(false))
  }

  return (
    <SharedHeader
      // The home link leads to schloss (Tafel has no home page of its
      // own), so the badge shows schloss's own logo mark, not Tafel's -
      // it should look like it goes to a different app, not display
      // Tafel's identity in a slot meant for "where this link goes".
      logo={
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2}>
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      }
      homeHref={schlossUrl}
      homeTitle="На главную"
      user={user ? { ...user, avatarUrl } : null}
      // The header's gear icon opens the platform-wide account settings
      // hosted on schlussel (password, delete account, ...) - NOT
      // Tafel's own /settings route, which is service-specific
      // preferences and stays reachable from the sidebar.
      onSettings={() => { window.location.href = buildSchluesselAccountUrl(window.location.pathname) }}
      onLogout={handleLogout}
      notifications={user && !loggingOut && services.glocke
        ? { href: `${glockeUrl}/notifications`, state: notificationState, glockeOrigin: glockeUrl, apiClient }
        : undefined}
      rightSlot={<ThemeToggle />}
      leftSlot={
        <button
          onClick={onOpenMobileMenu}
          className="show-mobile"
          aria-label="Меню"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, display: 'flex' }}
        >
          <Menu size={20} />
        </button>
      }
    />
  )
}
