import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { api, getAccessToken } from '../../lib/api'
import 'swagger-ui-dist/swagger-ui.css'

// Admin-only Swagger UI for kuvert's own API. Rendered as a normal page
// inside this already-authenticated app (protectedLayout's own beforeLoad
// already guarantees a token exists by the time this renders) rather than
// served raw by the backend, since a plain browser GET can't carry a
// Bearer header - useAuth() already holds one, threaded through to both
// the initial spec fetch and every "Try it out" call.
//
// kuvert/frontend has no client-side source of the current user's role
// outside React state (unlike schlussel/frontend, which has it from its
// own /me call too, but here useAuth() is the one place it already
// lives) - checked
// here in the component body rather than the route's beforeLoad, which
// runs before that state is available.
export function DocsPage() {
  const { user, loading } = useAuth()
  const containerRef = useRef<HTMLDivElement>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!user || user.role !== 'admin' || !containerRef.current) return
    let cancelled = false

    async function mount() {
      try {
        const [spec, { SwaggerUIBundle }] = await Promise.all([
          api.get<Record<string, unknown>>('/openapi.json'),
          import('swagger-ui-dist'),
        ])
        if (cancelled || !containerRef.current) return
        SwaggerUIBundle({
          domNode: containerRef.current,
          spec,
          presets: [SwaggerUIBundle.presets.apis],
          requestInterceptor: (req) => {
            // SwaggerRequest's own type only declares `url`/`credentials`
            // plus an index signature - `headers` is always present at
            // runtime but isn't statically typed, hence the cast.
            (req as unknown as { headers: Record<string, string> }).headers['Authorization'] = `Bearer ${getAccessToken()}`
            return req
          },
        })
      } catch {
        if (!cancelled) setLoadError('Не удалось загрузить документацию API')
      }
    }

    void mount()
    return () => {
      cancelled = true
    }
  }, [user])

  if (loading || !user) {
    return null
  }

  if (user.role !== 'admin') {
    return (
      <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center', padding: '2rem 0' }}>
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Доступ только для администраторов
        </h1>
        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          У вашей учётной записи нет прав администратора.
        </p>
      </div>
    )
  }

  return (
    <div>
      {loadError && (
        <div style={{ maxWidth: 480, margin: '0 auto 1rem', padding: '0.75rem 1rem', background: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 8, fontSize: '0.875rem', color: 'var(--danger)' }}>
          {loadError}
        </div>
      )}
      <div ref={containerRef} style={{ background: '#fff', margin: '0 -1.5rem' }} />
    </div>
  )
}
