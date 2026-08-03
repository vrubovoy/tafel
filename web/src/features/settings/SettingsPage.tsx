import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Field, Toast } from '@zudar107/schloss-ui'
import { api } from '../../lib/api'
import { useToast } from '../../hooks/useToast'

interface UserProfile {
  id: string
  email: string
  name: string
  weekStartsOn: 0 | 1
}

export function SettingsPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const [weekStartsOn, setWeekStartsOn] = useState<0 | 1>(1)
  const [saved, setSaved] = useState(false)

  const { data: profile, isLoading } = useQuery<UserProfile>({
    queryKey: ['userProfile'],
    queryFn: () => api.get('/users/me'),
  })

  useEffect(() => {
    if (profile) setWeekStartsOn(profile.weekStartsOn)
  }, [profile])

  const updateMutation = useMutation({
    mutationFn: (value: 0 | 1) => api.put('/users/me', { weekStartsOn: value }),
    onSuccess: (updated) => {
      qc.setQueryData(['userProfile'], updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
    onError: () => toast.showError('Не удалось сохранить настройки'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    updateMutation.mutate(weekStartsOn)
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
              value={String(weekStartsOn)}
              onChange={(e) => setWeekStartsOn(Number(e.target.value) as 0 | 1)}
            >
              <option value="1">Понедельник</option>
              <option value="0">Воскресенье</option>
            </Field>

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
      </div>

      {toast.toast && (
        <Toast open variant={toast.toast.variant} message={toast.toast.message} onDismiss={toast.dismiss} />
      )}
    </div>
  )
}
