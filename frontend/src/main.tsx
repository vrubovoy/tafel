import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { AuthContext, useAuthProvider } from './hooks/useAuth'
import { router } from './router'
import { queryClient } from './lib/queryClient'
import { getRuntimeConfig } from './lib/runtimeConfig'
import { applyTheme, getStoredTheme, ThemeSync } from '@zudar107/schloss-ui'
import './index.css'

// Same origin schlussel's own login/account links already point at (see
// lib/authRedirect.ts) - it doubles as the theme-sync API's origin since
// Tafel's own localStorage can't be read from schloss's or schlussel's
// origin directly.
applyTheme(getStoredTheme())

function Root() {
  const auth = useAuthProvider()
  const { schlusselUrl } = getRuntimeConfig()

  // Mounted unconditionally, before the auth-loading check below - theme
  // sync has nothing to do with being signed in, and shouldn't wait on it.
  const themeSync = <ThemeSync apiOrigin={schlusselUrl} />

  if (auth.loading) {
    return (
      <>
        {themeSync}
        <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Загрузка…</div>
        </div>
      </>
    )
  }

  return (
    <AuthContext.Provider value={auth}>
      {themeSync}
      <RouterProvider router={router} />
    </AuthContext.Provider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </StrictMode>,
)
