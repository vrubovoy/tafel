import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import { Modal, Button, ICON_SIZE } from '@zudar107/schloss-ui'
import { api } from '../../lib/api'
import { useToast } from '../../hooks/useToast'
import type { Status } from '../../lib/types'

export interface ManageStatusesModalProps {
  open: boolean
  onClose: () => void
  projectId: string
  statuses: Status[]
  // Number of (non-archived) tasks currently sitting in each status,
  // across the whole project - not just whatever subtask level the
  // Kanban board happens to be drilled into. Deleting a status with
  // tasks in it requires picking another status to move them to first
  // (see the API's reassignTo requirement); an empty status deletes
  // immediately, matching this app's no-confirm()-dialog convention for
  // every other destructive action.
  taskCountByStatus: Map<string, number>
}

export function ManageStatusesModal({ open, onClose, projectId, statuses, taskCountByStatus }: ManageStatusesModalProps) {
  const qc = useQueryClient()
  const toast = useToast()
  const [newName, setNewName] = useState('')
  const [reassigningId, setReassigningId] = useState<string | null>(null)
  const [reassignTarget, setReassignTarget] = useState('')

  const statusesKey = ['statuses', projectId]
  const invalidateAfterChange = () => {
    void qc.invalidateQueries({ queryKey: statusesKey })
    void qc.invalidateQueries({ queryKey: ['tasks', projectId] })
  }

  const createMutation = useMutation({
    mutationFn: (name: string) => api.post('/statuses', { projectId, name, sortOrder: statuses.length }),
    onSuccess: () => { setNewName(''); invalidateAfterChange() },
    onError: () => toast.showError('Не удалось добавить колонку'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<Status, 'name' | 'color' | 'isDone'>> }) =>
      api.put(`/statuses/${id}`, data),
    onSuccess: invalidateAfterChange,
    onError: () => toast.showError('Не удалось сохранить изменения'),
  })

  const reorderMutation = useMutation({
    mutationFn: (ordered: Status[]) =>
      Promise.all(ordered.map((s, i) => api.put(`/statuses/${s.id}`, { sortOrder: i }))),
    onSuccess: invalidateAfterChange,
    onError: () => toast.showError('Не удалось изменить порядок колонок'),
  })

  const deleteMutation = useMutation({
    mutationFn: ({ id, reassignTo }: { id: string; reassignTo?: string }) =>
      api.delete(`/statuses/${id}${reassignTo ? `?reassignTo=${reassignTo}` : ''}`),
    onSuccess: () => {
      setReassigningId(null)
      setReassignTarget('')
      invalidateAfterChange()
    },
    onError: () => toast.showError('Не удалось удалить колонку'),
  })

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = statuses.findIndex((s) => s.id === active.id)
    const newIndex = statuses.findIndex((s) => s.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    reorderMutation.mutate(arrayMove(statuses, oldIndex, newIndex))
  }

  function handleDeleteClick(status: Status) {
    const count = taskCountByStatus.get(status.id) ?? 0
    if (count === 0) {
      deleteMutation.mutate({ id: status.id })
    } else {
      setReassigningId(status.id)
      setReassignTarget(statuses.find((s) => s.id !== status.id)?.id ?? '')
    }
  }

  function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed) return
    createMutation.mutate(trimmed)
  }

  return (
    <Modal open={open} onClose={onClose} title="Колонки доски">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={statuses.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
            {statuses.map((status) => (
              <StatusRow
                key={status.id}
                status={status}
                taskCount={taskCountByStatus.get(status.id) ?? 0}
                canDelete={statuses.length > 1}
                onUpdate={(data) => updateMutation.mutate({ id: status.id, data })}
                onDeleteClick={() => handleDeleteClick(status)}
                reassigning={reassigningId === status.id}
                otherStatuses={statuses.filter((s) => s.id !== status.id)}
                reassignTarget={reassignTarget}
                onReassignTargetChange={setReassignTarget}
                onCancelReassign={() => setReassigningId(null)}
                onConfirmReassign={() => deleteMutation.mutate({ id: status.id, reassignTo: reassignTarget })}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <form onSubmit={handleAddSubmit} style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          className="input"
          placeholder="Новая колонка"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={!newName.trim() || createMutation.isPending} style={{ flexShrink: 0 }}>
          <Plus size={ICON_SIZE.default} /> Добавить
        </Button>
      </form>
    </Modal>
  )
}

function StatusRow({
  status, taskCount, canDelete, onUpdate, onDeleteClick,
  reassigning, otherStatuses, reassignTarget, onReassignTargetChange, onCancelReassign, onConfirmReassign,
}: {
  status: Status
  taskCount: number
  canDelete: boolean
  onUpdate: (data: Partial<Pick<Status, 'name' | 'color' | 'isDone'>>) => void
  onDeleteClick: () => void
  reassigning: boolean
  otherStatuses: Status[]
  reassignTarget: string
  onReassignTargetChange: (id: string) => void
  onCancelReassign: () => void
  onConfirmReassign: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: status.id })
  const [name, setName] = useState(status.name)

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  function commitName() {
    const trimmed = name.trim()
    if (trimmed && trimmed !== status.name) onUpdate({ name: trimmed })
    else setName(status.name)
  }

  return (
    <div ref={setNodeRef} style={style} className="card" >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.625rem' }}>
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Изменить порядок"
          style={{ background: 'none', border: 'none', cursor: 'grab', display: 'flex', color: 'var(--text-muted)', padding: 0, touchAction: 'none' }}
        >
          <GripVertical size={ICON_SIZE.default} />
        </button>

        <input
          type="color"
          value={status.color}
          onChange={(e) => onUpdate({ color: e.target.value })}
          style={{ width: 28, height: 28, padding: 2, border: '1px solid var(--border)', borderRadius: 6, flexShrink: 0, cursor: 'pointer' }}
          aria-label={`Цвет колонки «${status.name}»`}
        />

        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          style={{ flex: 1 }}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3125rem', fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={status.isDone} onChange={(e) => onUpdate({ isDone: e.target.checked })} />
          Финальная
        </label>

        <Button
          variant="ghost"
          onClick={onDeleteClick}
          disabled={!canDelete}
          title={canDelete ? 'Удалить колонку' : 'Нельзя удалить единственную колонку'}
          aria-label={`Удалить колонку «${status.name}»`}
          style={{ padding: '0.3rem', border: 'none', color: 'var(--danger)', flexShrink: 0 }}
        >
          <Trash2 size={ICON_SIZE.default} />
        </Button>
      </div>

      {reassigning && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
          padding: '0 0.625rem 0.625rem', fontSize: '0.8125rem', color: 'var(--text-secondary)',
        }}>
          <span>Перенести {taskCount} {taskCount === 1 ? 'задачу' : 'задачи(и)'} в:</span>
          <select
            className="input"
            style={{ width: 'auto', flex: '1 1 160px' }}
            value={reassignTarget}
            onChange={(e) => onReassignTargetChange(e.target.value)}
          >
            {otherStatuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Button variant="danger" onClick={onConfirmReassign} style={{ padding: '0.3rem 0.625rem', fontSize: '0.8125rem' }}>
            Удалить
          </Button>
          <Button variant="ghost" onClick={onCancelReassign} style={{ padding: '0.3rem 0.625rem', fontSize: '0.8125rem' }}>
            Отмена
          </Button>
        </div>
      )}
    </div>
  )
}
