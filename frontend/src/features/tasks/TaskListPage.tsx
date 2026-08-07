import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearch, useNavigate } from '@tanstack/react-router'
import { Plus, List as ListIcon, ChevronRight, ChevronDown, Calendar as CalendarIcon, Trash2 } from 'lucide-react'
import { EmptyState, ICON_SIZE, Button, Badge, formatDate } from '@zudar107/schloss-ui'
import { api } from '../../lib/api'
import { useToast } from '../../hooks/useToast'
import { useDateFormat } from '../../hooks/useDateFormat'
import type { Project } from '../projects/ProjectsPage'
import type { Status, Task } from '../../lib/types'
import { PRIORITY_COLORS } from '../../lib/types'
import { TaskFormModal } from './TaskFormModal'

export function TaskListPage() {
  const search = useSearch({ strict: false }) as { project?: string }
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const projectId = search.project

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [parentForNew, setParentForNew] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => api.get('/projects'),
  })

  const { data: statuses = [] } = useQuery<Status[]>({
    queryKey: ['statuses', projectId],
    queryFn: () => api.get(`/statuses?projectId=${projectId}`),
    enabled: !!projectId,
  })

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ['tasks', projectId, 'all'],
    queryFn: () => api.get(`/tasks?projectId=${projectId}`),
    enabled: !!projectId,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/tasks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      toast.showSuccess('Задача удалена')
    },
    onError: () => toast.showError('Не удалось удалить задачу'),
  })

  const statusById = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses])
  const childrenOf = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      const key = t.parentTaskId ?? ''
      const list = map.get(key) ?? []
      list.push(t)
      map.set(key, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.sortOrder - b.sortOrder)
    return map
  }, [tasks])

  const roots = childrenOf.get('') ?? []

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openCreate(parentTaskId: string | null = null) {
    setEditing(null)
    setParentForNew(parentTaskId)
    setFormOpen(true)
  }

  function openEdit(task: Task) {
    setEditing(task)
    setParentForNew(null)
    setFormOpen(true)
  }

  if (!projectId) {
    return (
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>Список задач</h1>
        {projects.length === 0 ? (
          <EmptyState
            icon={<ListIcon size={ICON_SIZE.illustrative} strokeWidth={2} />}
            title="Сначала создайте проект"
            description="Список задач показывается по одному проекту за раз."
            actionLabel="Перейти к проектам"
            onAction={() => navigate({ to: '/projects' })}
          />
        ) : (
          <ProjectPicker projects={projects} to="/tasks" />
        )}
      </div>
    )
  }

  const currentProject = projects.find((p) => p.id === projectId)

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 2 }}>
            <Link to="/projects" style={{ color: 'inherit', textDecoration: 'none' }}>Проекты</Link> / {currentProject?.name}
          </div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>Список задач</h1>
        </div>
        <Button variant="primary" style={{ fontSize: '0.8125rem', padding: '0.4rem 0.875rem' }} onClick={() => openCreate(null)}>
          <Plus size={15} /> Новая задача
        </Button>
      </div>

      {roots.length === 0 ? (
        <EmptyState
          icon={<ListIcon size={ICON_SIZE.illustrative} strokeWidth={2} />}
          title="Задач пока нет"
          description="Добавьте первую задачу этого проекта."
          actionLabel="Новая задача"
          actionIcon={<Plus size={16} />}
          onAction={() => openCreate(null)}
        />
      ) : (
        <div className="card" style={{ padding: '0.5rem' }}>
          {roots.map((task) => (
            <TaskTreeRow
              key={task.id}
              task={task}
              depth={0}
              statusById={statusById}
              childrenOf={childrenOf}
              collapsed={collapsed}
              onToggleCollapsed={toggleCollapsed}
              onEdit={openEdit}
              onAddSubtask={openCreate}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          ))}
        </div>
      )}

      <TaskFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        defaultProjectId={projectId}
        defaultParentTaskId={parentForNew}
        editing={editing}
      />
    </div>
  )
}

function ProjectPicker({ projects, to }: { projects: Project[]; to: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
      {projects.map((p) => (
        <Link
          key={p.id}
          to={to}
          search={{ project: p.id }}
          className="card"
          style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.625rem', textDecoration: 'none' }}
        >
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
          <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>{p.name}</span>
        </Link>
      ))}
    </div>
  )
}

function TaskTreeRow({ task, depth, statusById, childrenOf, collapsed, onToggleCollapsed, onEdit, onAddSubtask, onDelete }: {
  task: Task
  depth: number
  statusById: Map<string, Status>
  childrenOf: Map<string, Task[]>
  collapsed: Set<string>
  onToggleCollapsed: (id: string) => void
  onEdit: (task: Task) => void
  onAddSubtask: (parentTaskId: string) => void
  onDelete: (id: string) => void
}) {
  const [hover, setHover] = useState(false)
  const children = childrenOf.get(task.id) ?? []
  const hasChildren = children.length > 0
  const isCollapsed = collapsed.has(task.id)
  const status = statusById.get(task.statusId)
  const { dateFormat, timezone } = useDateFormat()

  return (
    <div>
      <div
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.5rem 0.5rem', paddingLeft: 8 + depth * 20,
          borderRadius: 8,
          background: hover ? 'var(--bg-base)' : 'transparent',
        }}
      >
        <button
          onClick={() => hasChildren && onToggleCollapsed(task.id)}
          style={{
            width: 18, height: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'none', border: 'none', cursor: hasChildren ? 'pointer' : 'default',
            color: 'var(--text-muted)', visibility: hasChildren ? 'visible' : 'hidden',
          }}
        >
          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>

        <span style={{ width: 6, height: 6, borderRadius: '50%', background: PRIORITY_COLORS[task.priority], flexShrink: 0 }} />

        <span
          onClick={() => onEdit(task)}
          style={{
            flex: 1, fontSize: '0.875rem', cursor: 'pointer',
            color: status?.isDone ? 'var(--text-muted)' : 'var(--text-primary)',
            textDecoration: status?.isDone ? 'line-through' : 'none',
          }}
        >
          {task.title}
        </span>

        {status && <Badge variant={status.isDone ? 'success' : 'neutral'} dot>{status.name}</Badge>}

        {task.dueDate && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <CalendarIcon size={12} /> {formatDate(task.dueDate, { dateFormat, timezone })}
          </span>
        )}

        {hover && (
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <Button variant="ghost" style={{ padding: '0.25rem', border: 'none' }} onClick={() => onAddSubtask(task.id)} aria-label="Добавить подзадачу">
              <Plus size={13} />
            </Button>
            <Button variant="ghost" style={{ padding: '0.25rem', border: 'none' }} onClick={() => onDelete(task.id)} aria-label="Удалить задачу">
              <Trash2 size={13} />
            </Button>
          </div>
        )}
      </div>

      {hasChildren && !isCollapsed && children.map((child) => (
        <TaskTreeRow
          key={child.id}
          task={child}
          depth={depth + 1}
          statusById={statusById}
          childrenOf={childrenOf}
          collapsed={collapsed}
          onToggleCollapsed={onToggleCollapsed}
          onEdit={onEdit}
          onAddSubtask={onAddSubtask}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}
