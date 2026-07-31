import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearch, useNavigate } from '@tanstack/react-router'
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCenter, useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Kanban as KanbanIcon, ChevronRight, ChevronUp, Calendar as CalendarIcon } from 'lucide-react'
import { EmptyState, ICON_SIZE, Button, Badge } from '@zudar107/schloss-ui'
import { api } from '../../lib/api'
import { useToast } from '../../hooks/useToast'
import { formatDate } from '../../lib/format'
import type { Project } from '../projects/ProjectsPage'
import type { Status, Task } from '../../lib/types'
import { PRIORITY_COLORS } from '../../lib/types'
import { TaskFormModal } from '../tasks/TaskFormModal'

export function KanbanPage() {
  const search = useSearch({ strict: false }) as { project?: string; parent?: string }
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()

  const projectId = search.project
  const parentTaskId = search.parent ?? null

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

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ['tasks', projectId, 'parent', parentTaskId ?? ''],
    queryFn: () => api.get(`/tasks?projectId=${projectId}&parentTaskId=${parentTaskId ?? ''}`),
    enabled: !!projectId,
  })

  // A task with children gets a "3/5" progress badge on its card without
  // fetching the whole subtree just to render it - one cheap extra
  // request per board (not per card), scoped to the tasks actually shown.
  const { data: allProjectTasks = [] } = useQuery<Task[]>({
    queryKey: ['tasks', projectId, 'all'],
    queryFn: () => api.get(`/tasks?projectId=${projectId}`),
    enabled: !!projectId,
  })

  const childCounts = useMemo(() => {
    const counts = new Map<string, { total: number; done: number }>()
    const doneStatusIds = new Set(statuses.filter((s) => s.isDone).map((s) => s.id))
    for (const t of allProjectTasks) {
      if (!t.parentTaskId) continue
      const entry = counts.get(t.parentTaskId) ?? { total: 0, done: 0 }
      entry.total++
      if (doneStatusIds.has(t.statusId)) entry.done++
      counts.set(t.parentTaskId, entry)
    }
    return counts
  }, [allProjectTasks, statuses])

  const currentProject = projects.find((p) => p.id === projectId)
  const parentTask = parentTaskId ? allProjectTasks.find((t) => t.id === parentTaskId) : null

  const reorderMutation = useMutation({
    mutationFn: ({ id, statusId, sortOrder }: { id: string; statusId: string; sortOrder: number }) =>
      api.put(`/tasks/${id}/reorder`, { statusId, sortOrder }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    onError: () => toast.showError('Не удалось переместить задачу'),
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const taskId = String(active.id)
    const overId = String(over.id)

    // over.id is either a column's own droppable id (dropped on empty
    // space) or another task's id (dropped near/on a card) - resolve to
    // the actual target status either way.
    const isColumnId = statuses.some((s) => s.id === overId)
    const targetStatusId = isColumnId ? overId : tasks.find((t) => t.id === overId)?.statusId
    if (!targetStatusId) return

    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.statusId === targetStatusId) return
    reorderMutation.mutate({ id: taskId, statusId: targetStatusId, sortOrder: 0 })
  }

  function openCreate() {
    setEditing(null)
    setFormOpen(true)
  }

  function openEdit(task: Task) {
    setEditing(task)
    setFormOpen(true)
  }

  function drillInto(taskId: string) {
    void navigate({ to: '/kanban', search: { project: projectId, parent: taskId } })
  }

  function drillUp() {
    void navigate({ to: '/kanban', search: { project: projectId } })
  }

  if (!projectId) {
    return (
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>Канбан</h1>
        {projects.length === 0 ? (
          <EmptyState
            icon={<KanbanIcon size={ICON_SIZE.illustrative} strokeWidth={2} />}
            title="Сначала создайте проект"
            description="У доски нет колонок без проекта — статусы задаются на уровне проекта."
            actionLabel="Перейти к проектам"
            onAction={() => navigate({ to: '/projects' })}
          />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
            {projects.map((p) => (
              <Link
                key={p.id}
                to="/kanban"
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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          <Link to="/projects" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Проекты</Link>
          <ChevronRight size={14} />
          <Link to="/kanban" search={{ project: projectId }} style={{ color: parentTask ? 'var(--text-secondary)' : 'var(--text-primary)', fontWeight: parentTask ? 400 : 600, textDecoration: 'none' }}>
            {currentProject?.name ?? '…'}
          </Link>
          {parentTask && (
            <>
              <ChevronRight size={14} />
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{parentTask.title}</span>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {parentTask && (
            <Button variant="ghost" style={{ fontSize: '0.8125rem' }} onClick={drillUp}>
              <ChevronUp size={15} /> Наверх
            </Button>
          )}
          <Button variant="primary" style={{ fontSize: '0.8125rem', padding: '0.4rem 0.875rem' }} onClick={openCreate}>
            <Plus size={15} /> {parentTask ? 'Новая подзадача' : 'Новая задача'}
          </Button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
          {statuses.map((status) => (
            <KanbanColumn
              key={status.id}
              status={status}
              tasks={tasks.filter((t) => t.statusId === status.id).sort((a, b) => a.sortOrder - b.sortOrder)}
              childCounts={childCounts}
              onEdit={openEdit}
              onDrillInto={drillInto}
            />
          ))}
        </div>
      </DndContext>

      <TaskFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        defaultProjectId={projectId}
        defaultParentTaskId={parentTaskId}
        editing={editing}
      />
    </div>
  )
}

function KanbanColumn({ status, tasks, childCounts, onEdit, onDrillInto }: {
  status: Status
  tasks: Task[]
  childCounts: Map<string, { total: number; done: number }>
  onEdit: (task: Task) => void
  onDrillInto: (taskId: string) => void
}) {
  return (
    <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0.25rem 0.75rem' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: status.color, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{status.name}</span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <DroppableColumnBody statusId={status.id}>
          {tasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              progress={childCounts.get(task.id)}
              isDone={status.isDone}
              onEdit={() => onEdit(task)}
              onDrillInto={() => onDrillInto(task.id)}
            />
          ))}
        </DroppableColumnBody>
      </SortableContext>
    </div>
  )
}

// dnd-kit's droppable area needs to be the *column*, not just each
// sortable item - an empty column (or dropping past the last card) has
// nowhere else to register as a drop target otherwise. Using the
// status id as this element's own droppable id lets handleDragEnd read
// `over.id` directly as the target status when dropped on empty space.
function DroppableColumnBody({ statusId, children }: { statusId: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: statusId })
  return (
    <div
      ref={setNodeRef}
      style={{
        display: 'flex', flexDirection: 'column', gap: '0.5rem',
        minHeight: 80, background: 'var(--bg-base)', borderRadius: 'var(--radius-md)',
        padding: '0.5rem',
      }}
    >
      {children}
    </div>
  )
}

function KanbanCard({ task, progress, isDone, onEdit, onDrillInto }: {
  task: Task
  progress?: { total: number; done: number }
  isDone: boolean
  onEdit: () => void
  onDrillInto: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({ id: task.id })
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }

  // Plays the "settle" pop only on the actual transition into a done
  // status - compared against the previous render via a ref, so a
  // background refetch that still reports the same done status doesn't
  // replay it.
  const wasDone = useRef(isDone)
  const [popping, setPopping] = useState(false)
  useEffect(() => {
    if (isDone && !wasDone.current) {
      setPopping(true)
      const t = setTimeout(() => setPopping(false), 250)
      wasDone.current = isDone
      return () => clearTimeout(t)
    }
    wasDone.current = isDone
  }, [isDone])

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={popping ? 'card card-pop' : 'card'}
      onClick={onEdit}
    >
      <div style={{ padding: '0.75rem', cursor: 'grab' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: task.dueDate || progress ? '0.5rem' : 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: PRIORITY_COLORS[task.priority], flexShrink: 0, marginTop: 6 }} />
          <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>{task.title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {task.dueDate && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
              <CalendarIcon size={11} /> {formatDate(task.dueDate)}
            </span>
          )}
          {progress && progress.total > 0 && (
            <Badge variant={progress.done === progress.total ? 'success' : 'neutral'}>
              {progress.done}/{progress.total}
            </Badge>
          )}
          {progress && progress.total > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onDrillInto() }}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
              aria-label="Открыть подзадачи"
            >
              <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
