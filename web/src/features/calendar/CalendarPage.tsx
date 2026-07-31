import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearch, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react'
import { EmptyState, ICON_SIZE, Button, Modal } from '@zudar107/schloss-ui'
import { api } from '../../lib/api'
import type { Project } from '../projects/ProjectsPage'
import type { Status, Task } from '../../lib/types'
import { PRIORITY_COLORS } from '../../lib/types'
import { TaskFormModal } from '../tasks/TaskFormModal'

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MONTH_LABELS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// 6-week (42-cell) grid starting on Monday, covering the full month plus
// the leading/trailing days needed to fill whole weeks.
function getMonthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const startOffset = (first.getDay() + 6) % 7 // Monday = 0
  const gridStart = new Date(year, month, 1 - startOffset)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(d.getDate() + i)
    return d
  })
}

export function CalendarPage() {
  const search = useSearch({ strict: false }) as { project?: string }
  const navigate = useNavigate()
  const projectId = search.project

  const [cursor, setCursor] = useState(() => new Date())
  const [dayModalDate, setDayModalDate] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => api.get('/projects'),
  })

  const { data: statuses = [] } = useQuery<Status[]>({
    queryKey: ['statuses', projectId],
    queryFn: () => api.get(`/statuses?projectId=${projectId}`),
    enabled: !!projectId,
  })

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const grid = useMemo(() => getMonthGrid(year, month), [year, month])
  const from = toISODate(grid[0]!)
  const to = toISODate(grid[grid.length - 1]!)

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ['tasks', projectId, 'range', from, to],
    queryFn: () => api.get(`/tasks?projectId=${projectId}&from=${from}&to=${to}`),
    enabled: !!projectId,
  })

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!t.dueDate) continue
      const list = map.get(t.dueDate) ?? []
      list.push(t)
      map.set(t.dueDate, list)
    }
    return map
  }, [tasks])

  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses])
  const currentProject = projects.find((p) => p.id === projectId)

  if (!projectId) {
    return (
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>Календарь</h1>
        {projects.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon size={ICON_SIZE.illustrative} strokeWidth={2} />}
            title="Сначала создайте проект"
            description="Календарь показывает сроки задач по одному проекту за раз."
            actionLabel="Перейти к проектам"
            onAction={() => navigate({ to: '/projects' })}
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
            {projects.map((p) => (
              <Link
                key={p.id}
                to="/calendar"
                search={{ project: p.id }}
                className="card"
                style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.625rem', textDecoration: 'none' }}
              >
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>{p.name}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    )
  }

  const dayModalTasks = dayModalDate ? (tasksByDay.get(dayModalDate) ?? []) : []

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>
            <Link to="/projects" style={{ color: 'inherit', textDecoration: 'none' }}>Проекты</Link> / {currentProject?.name}
          </div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {MONTH_LABELS[month]} {year}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Button variant="ghost" style={{ padding: '0.4rem' }} onClick={() => setCursor(new Date(year, month - 1, 1))} aria-label="Предыдущий месяц">
            <ChevronLeft size={16} />
          </Button>
          <Button variant="ghost" style={{ fontSize: '0.8125rem' }} onClick={() => setCursor(new Date())}>Сегодня</Button>
          <Button variant="ghost" style={{ padding: '0.4rem' }} onClick={() => setCursor(new Date(year, month + 1, 1))} aria-label="Следующий месяц">
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} style={{ background: 'var(--bg-surface)', padding: '0.5rem', textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
            {label}
          </div>
        ))}
        {grid.map((day) => {
          const iso = toISODate(day)
          const inMonth = day.getMonth() === month
          const isToday = iso === toISODate(new Date())
          const dayTasks = tasksByDay.get(iso) ?? []
          const visible = dayTasks.slice(0, 3)
          const overflow = dayTasks.length - visible.length

          return (
            <div
              key={iso}
              style={{
                background: 'var(--bg-surface)', minHeight: 88, padding: '0.375rem',
                opacity: inMonth ? 1 : 0.4,
                display: 'flex', flexDirection: 'column', gap: '0.25rem',
              }}
            >
              <span style={{
                fontSize: '0.75rem', fontWeight: isToday ? 700 : 500,
                color: isToday ? 'var(--accent)' : 'var(--text-secondary)',
              }}>
                {day.getDate()}
              </span>
              {visible.map((t) => {
                const status = statusById.get(t.statusId)
                return (
                  <div
                    key={t.id}
                    onClick={() => { setEditing(t); setFormOpen(true) }}
                    style={{
                      fontSize: '0.6875rem', padding: '1px 4px', borderRadius: 4, cursor: 'pointer',
                      background: `${PRIORITY_COLORS[t.priority]}20`,
                      color: status?.isDone ? 'var(--text-muted)' : 'var(--text-primary)',
                      textDecoration: status?.isDone ? 'line-through' : 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {t.title}
                  </div>
                )
              })}
              {overflow > 0 && (
                <button
                  onClick={() => setDayModalDate(iso)}
                  style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                >
                  +{overflow} ещё
                </button>
              )}
            </div>
          )
        })}
      </div>

      <Modal
        open={!!dayModalDate}
        onClose={() => setDayModalDate(null)}
        title={dayModalDate ? formatLongDate(dayModalDate) : ''}
        icon={<CalendarIcon size={ICON_SIZE.default} strokeWidth={2} />}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {dayModalTasks.map((t) => {
            const status = statusById.get(t.statusId)
            return (
              <div
                key={t.id}
                onClick={() => { setDayModalDate(null); setEditing(t); setFormOpen(true) }}
                className="card"
                style={{ padding: '0.625rem 0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: PRIORITY_COLORS[t.priority], flexShrink: 0 }} />
                <span style={{ fontSize: '0.875rem', color: status?.isDone ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: status?.isDone ? 'line-through' : 'none' }}>
                  {t.title}
                </span>
              </div>
            )
          })}
        </div>
      </Modal>

      <TaskFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        defaultProjectId={projectId}
        editing={editing}
      />
    </div>
  )
}

function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}
