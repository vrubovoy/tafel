import { useQuery } from '@tanstack/react-query'
import { BarChart3 } from 'lucide-react'
import { StatTile, Sparkline, Badge, ICON_SIZE } from '@zudar107/schloss-ui'
import { api } from '../../lib/api'

interface StatsSummary {
  totalTasks: number
  completedTasks: number
  completionRate: number
  overdueTasks: number
  tasksByProject: { projectId: string; name: string; color: string; total: number; completed: number }[]
  completedLast14Days: number[]
  currentStreak: number
  activeRecurringTasks: number
}

export function StatsPage() {
  const { data, isLoading } = useQuery<StatsSummary>({
    queryKey: ['stats', 'summary'],
    queryFn: () => api.get('/stats/summary'),
  })

  if (isLoading || !data) return null

  if (data.totalTasks === 0) {
    return (
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 1.5rem', fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>Статистика</h1>
        <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: 'var(--accent-muted)', color: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1rem',
          }}>
            <BarChart3 size={ICON_SIZE.illustrative} strokeWidth={2} />
          </div>
          <h2 style={{ margin: '0 0 0.5rem', color: 'var(--text-primary)', fontSize: '1.125rem', fontWeight: 600 }}>
            Пока нет данных для статистики
          </h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Статистика появится, как только вы создадите первые задачи.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 1.5rem', fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>Статистика</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <StatTile label="Всего задач" value={data.totalTasks} />
        <StatTile label="Выполнено" value={data.completedTasks} accent />
        <StatTile label="Процент выполнения" value={`${Math.round(data.completionRate * 100)}%`} />
        <StatTile label="Просрочено" value={data.overdueTasks} />
        <StatTile label="Серия дней" value={data.currentStreak} accent />
        <StatTile label="Повторяющихся" value={data.activeRecurringTasks} />
      </div>

      <div className="card" style={{ padding: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem' }}>
          Выполнено за 14 дней
        </div>
        <Sparkline values={data.completedLast14Days} height={40} />
      </div>

      {data.tasksByProject.length > 0 && (
        <div className="card" style={{ padding: '1rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem' }}>
            По проектам
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {data.tasksByProject.map((p) => (
              <div key={p.projectId} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: '0.875rem', color: 'var(--text-primary)' }}>{p.name}</span>
                <Badge variant={p.completed === p.total && p.total > 0 ? 'success' : 'neutral'}>
                  {p.completed}/{p.total}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
