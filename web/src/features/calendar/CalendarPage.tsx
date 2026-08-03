import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearch, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react'
import { EmptyState, ICON_SIZE, Modal } from '@zudar107/schloss-ui'
import { api } from '../../lib/api'
import type { Project } from '../projects/ProjectsPage'
import type { Status, Task } from '../../lib/types'
import { PRIORITY_COLORS } from '../../lib/types'
import { TaskFormModal } from '../tasks/TaskFormModal'

// Index = JS Date#getDay() (0 = Sunday ... 6 = Saturday), so a weekday's
// label and "is it a weekend" check both key off the same absolute index
// regardless of which day the grid itself starts on.
const WEEKDAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
const MONTH_LABELS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 6-week (42-cell) grid starting on `weekStartsOn` (0 = Sunday, 1 =
// Monday), covering the full month plus the leading/trailing days needed
// to fill whole weeks.
function getMonthGrid(year: number, month: number, weekStartsOn: 0 | 1): Date[] {
  const first = new Date(year, month, 1)
  const startOffset = (first.getDay() - weekStartsOn + 7) % 7
  const gridStart = new Date(year, month, 1 - startOffset)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(d.getDate() + i)
    return d
  })
}

interface UserProfile {
  weekStartsOn: 0 | 1
}

export function CalendarPage() {
  const search = useSearch({ strict: false }) as { project?: string }
  const navigate = useNavigate()
  const projectId = search.project

  const [cursor, setCursor] = useState(() => new Date())
  const [dayModalDate, setDayModalDate] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)

  const { data: profile } = useQuery<UserProfile>({
    queryKey: ['userProfile'],
    queryFn: () => api.get('/users/me'),
  })
  const weekStartsOn = profile?.weekStartsOn ?? 1

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
  const grid = useMemo(() => getMonthGrid(year, month, weekStartsOn), [year, month, weekStartsOn])
  const weekdayOrder = useMemo(() => Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7), [weekStartsOn])
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
  const todayIso = toISODate(new Date())

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>
            <Link to="/projects" style={{ color: 'inherit', textDecoration: 'none' }}>Проекты</Link> / {currentProject?.name}
          </div>
          <h1 style={{ margin: 0, fontSize: '1.375rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: currentProject?.color ?? 'var(--accent)', flexShrink: 0 }} />
            {MONTH_LABELS[month]} {year}
          </h1>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 2,
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 3,
        }}>
          <NavButton onClick={() => setCursor(new Date(year, month - 1, 1))} aria-label="Предыдущий месяц">
            <ChevronLeft size={16} />
          </NavButton>
          <NavButton onClick={() => setCursor(new Date())} wide>Сегодня</NavButton>
          <NavButton onClick={() => setCursor(new Date(year, month + 1, 1))} aria-label="Следующий месяц">
            <ChevronRight size={16} />
          </NavButton>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', marginBottom: '0.5rem' }}>
        {weekdayOrder.map((dow) => {
          const isWeekend = dow === 0 || dow === 6
          return (
            <span
              key={dow}
              style={{
                textAlign: 'center', fontSize: '0.6875rem', fontWeight: 600,
                letterSpacing: '0.06em', textTransform: 'uppercase', paddingBottom: '0.375rem',
                color: isWeekend ? 'var(--accent-hover)' : 'var(--text-muted)',
              }}
            >
              {WEEKDAY_NAMES[dow]}
            </span>
          )
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gridTemplateRows: 'repeat(6, 1fr)', gap: '0.5rem' }}>
        {grid.map((day) => {
          const iso = toISODate(day)
          const inMonth = day.getMonth() === month
          const isToday = iso === todayIso
          const isWeekend = day.getDay() === 0 || day.getDay() === 6
          const dayTasks = tasksByDay.get(iso) ?? []
          const visible = dayTasks.slice(0, 3)
          const overflow = dayTasks.length - visible.length

          return (
            <div
              key={iso}
              style={{
                background: isWeekend ? 'color-mix(in srgb, var(--bg-surface) 88%, var(--accent) 5%)' : 'var(--bg-surface)',
                border: `1px solid ${isToday ? 'var(--accent)' : 'var(--border)'}`,
                boxShadow: isToday ? '0 0 0 1px var(--accent)' : undefined,
                borderRadius: 'var(--radius-md)', minHeight: 96, minWidth: 0,
                padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem',
                opacity: inMonth ? 1 : 0.4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{
                  fontSize: '0.75rem', fontWeight: isToday ? 700 : 500,
                  color: isToday ? 'var(--text-inverted)' : 'var(--text-secondary)',
                  background: isToday ? 'var(--accent)' : 'transparent',
                  width: 20, height: 20, borderRadius: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {day.getDate()}
                </span>
                {dayTasks.length > 0 && (
                  <span style={{
                    fontSize: '0.625rem', fontWeight: 600, color: 'var(--text-muted)',
                    background: 'var(--bg-base)', borderRadius: 5, padding: '0 4px', minWidth: 14, textAlign: 'center',
                  }}>
                    {dayTasks.length}
                  </span>
                )}
              </div>
              {visible.map((t) => {
                const status = statusById.get(t.statusId)
                return (
                  <div
                    key={t.id}
                    onClick={() => { setEditing(t); setFormOpen(true) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.3125rem', minWidth: 0,
                      fontSize: '0.6875rem', padding: '2px 5px 2px 4px', borderRadius: 6, cursor: 'pointer',
                      background: 'var(--bg-base)',
                      color: status?.isDone ? 'var(--text-muted)' : 'var(--text-primary)',
                      textDecoration: status?.isDone ? 'line-through' : 'none',
                    }}
                  >
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: PRIORITY_COLORS[t.priority], flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{t.title}</span>
                  </div>
                )
              })}
              {overflow > 0 && (
                <button
                  onClick={() => setDayModalDate(iso)}
                  style={{ fontSize: '0.625rem', fontWeight: 600, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: '1px 4px' }}
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

function NavButton({ onClick, children, wide, ...rest }: {
  onClick: () => void
  children: React.ReactNode
  wide?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: 'none', background: 'transparent', color: wide ? 'var(--text-primary)' : 'var(--text-secondary)',
        width: wide ? 'auto' : 30, height: 28, borderRadius: 8, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: wide ? '0 0.75rem' : 0, fontSize: '0.8125rem', fontWeight: wide ? 600 : 400,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      {...rest}
    >
      {children}
    </button>
  )
}

function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}
