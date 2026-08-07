import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearch, useNavigate } from '@tanstack/react-router'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCenter, useDroppable,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, ChevronRight, ChevronUp, Calendar as CalendarIcon, Settings } from 'lucide-react'
import { EmptyState, Button, Badge, formatDate } from '@zudar107/schloss-ui'
import { api } from '../../lib/api'
import { useToast } from '../../hooks/useToast'
import { useDateFormat } from '../../hooks/useDateFormat'
import type { Project } from '../projects/ProjectsPage'
import type { Status, Task } from '../../lib/types'
import { PRIORITY_COLORS } from '../../lib/types'
import { TaskFormModal } from '../tasks/TaskFormModal'
import { ManageStatusesModal } from './ManageStatusesModal'
import { HeroIllustration } from '../../components/HeroIllustration'

export function KanbanPage() {
  const search = useSearch({ strict: false }) as { project?: string; parent?: string }
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()

  const projectId = search.project
  const parentTaskId = search.parent ?? null

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [statusesModalOpen, setStatusesModalOpen] = useState(false)

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
    const childrenByParent = new Map<string, Task[]>()
    for (const task of allProjectTasks) {
      if (!task.parentTaskId) continue
      const children = childrenByParent.get(task.parentTaskId) ?? []
      children.push(task)
      childrenByParent.set(task.parentTaskId, children)
    }
    for (const task of allProjectTasks) {
      const descendants = [...(childrenByParent.get(task.id) ?? [])]
      const seen = new Set<string>([task.id])
      let total = 0
      let done = 0
      while (descendants.length > 0) {
        const descendant = descendants.pop()!
        if (seen.has(descendant.id)) continue
        seen.add(descendant.id)
        total++
        if (doneStatusIds.has(descendant.statusId)) done++
        descendants.push(...(childrenByParent.get(descendant.id) ?? []))
      }
      if (total > 0) counts.set(task.id, { total, done })
    }
    return counts
  }, [allProjectTasks, statuses])

  // Whole-project (not parent-scoped) task count per status - matches
  // what the DELETE /statuses/:id endpoint itself checks, so the
  // "delete this column" flow knows up front whether it needs to ask
  // where to move that column's tasks first.
  const taskCountByStatus = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of allProjectTasks) counts.set(t.statusId, (counts.get(t.statusId) ?? 0) + 1)
    return counts
  }, [allProjectTasks])

  const currentProject = projects.find((p) => p.id === projectId)
  const parentTask = parentTaskId ? allProjectTasks.find((t) => t.id === parentTaskId) : null
  const ancestorPath = useMemo(() => {
    if (!parentTask) return []
    const taskById = new Map(allProjectTasks.map((task) => [task.id, task]))
    const path: Task[] = []
    const seen = new Set<string>()
    let current: Task | undefined = parentTask
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      path.push(current)
      current = current.parentTaskId ? taskById.get(current.parentTaskId) : undefined
    }
    return path.reverse()
  }, [allProjectTasks, parentTask])

  // Optimistic: without this, a dropped card would sit frozen in its
  // origin column until the PUT round-trips and the refetch resolves,
  // reading as laggy/unresponsive drag-and-drop. Patches both task-list
  // caches (the current view and the "all" one behind child-progress
  // badges) immediately, then reconciles with the server's own result
  // (e.g. its computed sortOrder) via the settle-time invalidate.
  const tasksKey = ['tasks', projectId, 'parent', parentTaskId ?? '']
  const allTasksKey = ['tasks', projectId, 'all']

  const reorderMutation = useMutation({
    mutationFn: ({ id, statusId, sortOrder }: { id: string; statusId: string; sortOrder: number }) =>
      api.put(`/tasks/${id}/reorder`, { statusId, sortOrder }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  // Drives the DragOverlay's floating preview - without it, the dragged
  // card just translates in place within its own column's flow (dnd-kit's
  // default for useSortable), which reads as sluggish once other cards
  // have to shift around it. The overlay clone follows the pointer
  // directly while the source card fades via KanbanCard's isDragging.
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  function handleDragStart(event: DragStartEvent) {
    setActiveTask(tasks.find((t) => t.id === String(event.active.id)) ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) {
      setActiveTask(null)
      return
    }
    const taskId = String(active.id)
    const overId = String(over.id)

    // over.id is either a column's own droppable id (dropped on empty
    // space) or another task's id (dropped near/on a card) - resolve to
    // the actual target status either way.
    const isColumnId = statuses.some((s) => s.id === overId)
    const targetStatusId = isColumnId ? overId : tasks.find((t) => t.id === overId)?.statusId
    const task = tasks.find((t) => t.id === taskId)

    if (!targetStatusId || !task || overId === taskId) {
      setActiveTask(null)
      return
    }

    const targetColumnTasks = tasks
      .filter((candidate) => candidate.statusId === targetStatusId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const targetIndex = isColumnId
      ? targetColumnTasks.length
      : targetColumnTasks.findIndex((candidate) => candidate.id === overId)
    if (targetIndex < 0) {
      setActiveTask(null)
      return
    }

    // Patches the cache and clears the drag overlay in the same
    // synchronous call, so both commit in one React render. Doing the
    // patch inside the mutation's own onMutate instead (as this used to)
    // defers it to a later microtask - the overlay would disappear one
    // render before the card actually moved columns, showing the card
    // snap back to its old spot for a frame before popping into the new
    // column: a visible duplicate/flash.
    void qc.cancelQueries({ queryKey: tasksKey })
    void qc.cancelQueries({ queryKey: allTasksKey })
    const previousTasks = qc.getQueryData<Task[]>(tasksKey)
    const previousAllTasks = qc.getQueryData<Task[]>(allTasksKey)
    const patch = (list?: Task[]) => {
      if (!list) return list
      const source = list
        .filter((candidate) => candidate.id !== taskId
          && candidate.parentTaskId === task.parentTaskId
          && candidate.statusId === task.statusId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      const target = (targetStatusId === task.statusId
        ? source
        : list.filter((candidate) => candidate.id !== taskId
          && candidate.parentTaskId === task.parentTaskId
          && candidate.statusId === targetStatusId))
        .sort((a, b) => a.sortOrder - b.sortOrder)
      target.splice(Math.min(targetIndex, target.length), 0, { ...task, statusId: targetStatusId })

      const updates = new Map<string, Pick<Task, 'statusId' | 'sortOrder'>>()
      if (targetStatusId !== task.statusId) {
        source.forEach((candidate, index) => updates.set(candidate.id, { statusId: candidate.statusId, sortOrder: index }))
      }
      target.forEach((candidate, index) => updates.set(candidate.id, { statusId: targetStatusId, sortOrder: index }))
      return list.map((candidate) => {
        const update = updates.get(candidate.id)
        return update ? { ...candidate, ...update } : candidate
      })
    }
    qc.setQueryData<Task[]>(tasksKey, patch(previousTasks))
    qc.setQueryData<Task[]>(allTasksKey, patch(previousAllTasks))
    setActiveTask(null)

    reorderMutation.mutate({ id: taskId, statusId: targetStatusId, sortOrder: targetIndex }, {
      onError: () => {
        qc.setQueryData(tasksKey, previousTasks)
        qc.setQueryData(allTasksKey, previousAllTasks)
        toast.showError('Не удалось переместить задачу')
      },
    })
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
    void navigate({
      to: '/kanban',
      search: parentTask?.parentTaskId
        ? { project: projectId, parent: parentTask.parentTaskId }
        : { project: projectId },
    })
  }

  if (!projectId) {
    return (
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>Канбан</h1>
        {projects.length === 0 ? (
          <EmptyState
            illustration={<HeroIllustration size={100} />}
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
          <Link to="/projects" search={{}} style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Проекты</Link>
          <ChevronRight size={14} />
          <Link to="/kanban" search={{ project: projectId }} style={{ color: parentTask ? 'var(--text-secondary)' : 'var(--text-primary)', fontWeight: parentTask ? 400 : 600, textDecoration: 'none' }}>
            {currentProject?.name ?? '…'}
          </Link>
          {ancestorPath.map((ancestor, index) => (
            <span key={ancestor.id} style={{ display: 'contents' }}>
              <ChevronRight size={14} />
              {index === ancestorPath.length - 1 ? (
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{ancestor.title}</span>
              ) : (
                <Link
                  to="/kanban"
                  search={{ project: projectId, parent: ancestor.id }}
                  style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
                >
                  {ancestor.title}
                </Link>
              )}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {parentTask && (
            <Button variant="ghost" style={{ fontSize: '0.8125rem' }} onClick={drillUp}>
              <ChevronUp size={15} /> Наверх
            </Button>
          )}
          <Button variant="ghost" style={{ padding: '0.4rem' }} onClick={() => setStatusesModalOpen(true)} aria-label="Настроить колонки">
            <Settings size={15} />
          </Button>
          <Button variant="primary" style={{ fontSize: '0.8125rem', padding: '0.4rem 0.875rem' }} onClick={openCreate}>
            <Plus size={15} /> {parentTask ? 'Новая подзадача' : 'Новая задача'}
          </Button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveTask(null)}
      >
        <div style={{ display: 'flex', alignItems: 'stretch', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
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
        {/* No drop animation: dnd-kit's default one measures the sortable
            item's *current* DOM rect to fly the overlay toward, but that
            item only knows about positions within its own column - on a
            cross-column drop it's still sitting in the origin column at
            that instant, so the overlay would fly back there and fade
            out while the real card (already patched into its new column,
            see handleDragEnd) is visible at the same time: a duplicate/
            flash. Dropping instantly instead reads as a clean, immediate
            placement. */}
        <DragOverlay dropAnimation={null}>
          {activeTask && (
            <div className="card" style={{ width: 280, boxShadow: 'var(--shadow-lg)' }}>
              <KanbanCardContent task={activeTask} progress={childCounts.get(activeTask.id)} dragging />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <TaskFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        defaultProjectId={projectId}
        defaultParentTaskId={parentTaskId}
        editing={editing}
      />

      <ManageStatusesModal
        open={statusesModalOpen}
        onClose={() => setStatusesModalOpen(false)}
        projectId={projectId}
        statuses={statuses}
        taskCountByStatus={taskCountByStatus}
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
    <div className="card" style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', padding: '0.75rem' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        padding: '0.25rem 0.25rem 0.75rem', marginBottom: '0.5rem',
        borderBottom: '1px solid var(--border)',
      }}>
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
// flex:1 stretches every column's body to the row's own height (set via
// KanbanPage's alignItems:'stretch'), so columns read as equal-height
// board lanes instead of shrink-wrapping to however many cards they hold.
function DroppableColumnBody({ statusId, children }: { statusId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: statusId })
  return (
    <div
      ref={setNodeRef}
      style={{
        display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1,
        minHeight: 80, background: isOver ? 'var(--accent-muted)' : 'var(--bg-base)',
        borderRadius: 'var(--radius-md)', padding: '0.5rem',
        transition: 'background 120ms',
      }}
    >
      {children}
    </div>
  )
}

function KanbanCardContent({ task, progress, onDrillInto, dragging }: {
  task: Task
  progress?: { total: number; done: number }
  onDrillInto?: () => void
  dragging?: boolean
}) {
  const { dateFormat, timezone } = useDateFormat()
  return (
    <div style={{ padding: '0.75rem', cursor: dragging ? 'grabbing' : 'grab' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: task.dueDate || progress ? '0.5rem' : 0 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: PRIORITY_COLORS[task.priority], flexShrink: 0, marginTop: 6 }} />
        <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>{task.title}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        {task.dueDate && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
            <CalendarIcon size={11} /> {formatDate(task.dueDate, { dateFormat, timezone })}
          </span>
        )}
        {progress && progress.total > 0 && (
          <Badge variant={progress.done === progress.total ? 'success' : 'neutral'}>
            {progress.done}/{progress.total}
          </Badge>
        )}
        {progress && progress.total > 0 && onDrillInto && (
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
    opacity: isDragging ? 0.3 : 1,
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
      <KanbanCardContent task={task} progress={progress} onDrillInto={onDrillInto} />
    </div>
  )
}
