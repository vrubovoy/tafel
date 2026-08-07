import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Toast } from '@zudar107/schloss-ui'
import { api } from '../../lib/api'
import { useToast } from '../../hooks/useToast'

interface UserProfile {
  id: string
  email: string
  name: string
  // The effective value actually used by the calendar (Tafel override if
  // set, otherwise the platform-wide preference from Schlüssel,
  // otherwise Monday).
  weekStartsOn: 0 | 1
  // The raw Tafel-specific override, separately - null means "no
  // override, following the Schlüssel profile setting", which the select
  // below needs to distinguish from an explicit Monday/Sunday choice.
  weekStartsOnOverride: 0 | 1 | null
}

// '' (the select's "use platform default" option) maps to `null` on the
// wire - a real override is always exactly '0' or '1'.
type WeekStartSelection = '' | '0' | '1'

export function SettingsPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const [weekStartsOn, setWeekStartsOn] = useState<WeekStartSelection>('')
  const [saved, setSaved] = useState(false)

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ['userProfile'],
    queryFn: () => api.get('/users/me'),
  })

  useEffect(() => {
    if (profile) setWeekStartsOn(profile.weekStartsOnOverride === null ? '' : String(profile.weekStartsOnOverride) as WeekStartSelection)
  }, [profile])

  const updateMutation = useMutation({
    mutationFn: (value: 0 | 1 | null) => api.put('/users/me', { weekStartsOn: value }),
    onSuccess: (updated) => {
      qc.setQueryData(['userProfile'], updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
    onError: () => toast.showError('Не удалось сохранить настройки'),
  })

  const exportMutation = useMutation({
    mutationFn: () => api.get<Record<string, unknown>>('/users/export'),
    onSuccess: (data) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `tafel-export-${new Date().toISOString().slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
    },
    onError: () => toast.showError('Не удалось экспортировать данные'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    updateMutation.mutate(weekStartsOn === '' ? null : (Number(weekStartsOn) as 0 | 1))
  }

  return (
    <div style={{ maxWidth: 500, margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
          Настройки
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
          Профиль и предпочтения
        </p>
      </div>

      <div className="card" style={{ padding: '1.5rem' }}>
        {isLoading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Загрузка…</div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {profile && (
              <div>
                <div className="label">Аккаунт</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>{profile.name}</div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>{profile.email}</div>
              </div>
            )}

            <Field
              as="select"
              id="settings-week-start"
              label="Начало недели"
              value={weekStartsOn}
              onChange={(e) => setWeekStartsOn(e.target.value as WeekStartSelection)}
            >
              <option value="">Как в профиле Schlüssel{profile ? ` (сейчас: ${profile.weekStartsOn === 1 ? 'Понедельник' : 'Воскресенье'})` : ''}</option>
              <option value="1">Понедельник</option>
              <option value="0">Воскресенье</option>
            </Field>
            <p style={{ margin: '-0.5rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Общая настройка задаётся в профиле Schlüssel (значок аккаунта в шапке) и действует
              на всех сервисах платформы. Здесь можно переопределить её только для Tafel.
            </p>

            <Button
              type="submit"
              variant="primary"
              disabled={updateMutation.isPending}
              style={{ justifyContent: 'center', padding: '0.625rem' }}
            >
              {updateMutation.isPending ? 'Сохранение…' : saved ? 'Сохранено ✓' : 'Сохранить'}
            </Button>
          </form>
        )}

        <p style={{ margin: '1rem 0 0', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          Смена пароля и удаление аккаунта — в настройках Schlüssel (доступны через значок профиля в шапке).
        </p>

        <div style={{ borderTop: '1px solid var(--border)', marginTop: '1rem', paddingTop: '1rem' }}>
          <div className="label">Данные Tafel</div>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            Скачать проекты, статусы и задачи, включая архивные, в формате JSON.
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={exportMutation.isPending}
            onClick={() => exportMutation.mutate()}
          >
            {exportMutation.isPending ? 'Подготовка…' : 'Экспортировать данные'}
          </Button>
        </div>
      </div>

      {toast.toast && (
        <Toast open variant={toast.toast.variant} message={toast.toast.message} onDismiss={toast.dismiss} />
      )}
    </div>
  )
}
