import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { setAccessToken } from '../../lib/api'
import { useAuth } from '../../hooks/useAuth'
import { CODE_VERIFIER_STORAGE_KEY } from '../../lib/authRedirect'
import type { AuthUser } from '../../hooks/useAuth'

// Landed on after schlussel's hosted login redirects back with `?code=...`
// (a one-time authorization code, PKCE flow). Exchanges it - together with
// the verifier stashed in sessionStorage before leaving - for the real
// access token via POST /auth/token, strips the code from the URL/history
// immediately (it must not sit around visible or bookmarkable), then hands
// off to the originally-requested page via a client-side navigation — a
// full reload here would wipe the just-set access token, which lives only
// in memory.
//
// /auth/token returns both the token and the user in one response, so
// there's no separate /auth/me round trip needed anymore (unlike the old
// fragment-token flow, which only carried the token and had to fetch the
// user object itself).
export function AuthCallbackPage() {
  const navigate = useNavigate()
  const { setUser } = useAuth()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const next = params.get('next') ?? '/kanban'
    history.replaceState(null, '', window.location.pathname)

    const codeVerifier = sessionStorage.getItem(CODE_VERIFIER_STORAGE_KEY)
    sessionStorage.removeItem(CODE_VERIFIER_STORAGE_KEY)

    if (!code || !codeVerifier) {
      navigate({ to: next, replace: true })
      return
    }

    fetch('/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier }),
    })
      .then((res) => (res.ok ? res.json() as Promise<{ accessToken: string; user: AuthUser }> : null))
      .then((data) => {
        if (!data) return
        setAccessToken(data.accessToken)
        setUser(data.user)
      })
      .catch(() => {})
      .finally(() => navigate({ to: next, replace: true }))
  }, [navigate, setUser])

  return <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }} />
}
