import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ListTodo } from 'lucide-react'
import { Field, DateField, Modal, handleArrowFieldNavigation } from '@zudar107/schloss-ui'
import { api } from '../../lib/api'
import { useToast } from '../../hooks/useToast'
import type { Project } from '../projects/ProjectsPage'
import type { Status, Task, Priority } from '../../lib/types'
import { PRIORITY_LABELS } from '../../lib/types'

const TASK_FORM_ID = 'task-form'
const TASK_TITLE_PLACEHOLDER = 'Написать черновик'

export interface TaskFormModalProps {
  open: boolean
  onClose: () => void
  // Pre-selects the project (e.g. opened from a Kanban board already
  // scoped to one project) - if omitted, the user picks from a select.
  defaultProjectId?: string
  // Pre-fills the parent when creating a subtask from an existing row/card.
  defaultParentTaskId?: string | null
  editing?: Task | null
  onSaved?: (task: Task) => void
}

interface FormValues {
  projectId: string
  statusId: string
  title: string
  description: string
  priority: Priority
  dueDate: string
  recurrenceInterval: '' | 'daily' | 'weekly' | 'monthly'
  recurrenceCount: string
}

function emptyForm(projectId: string): FormValues {
  return {
    projectId, statusId: '', title: '', description: '', priority: 'medium',
    dueDate: '', recurrenceInterval: '', recurrenceCount: '1',
  }
}

export function TaskFormModal({ open, onClose, defaultProjectId, defaultParentTaskId, editing, onSaved }: TaskFormModalProps) {
  const qc = useQueryClient()
  const toast = useToast()
  const isEditing = !!editing

  const [values, setValues] = useState<FormValues>(() => emptyForm(defaultProjectId ?? ''))

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => api.get('/projects'),
    enabled: open,
  })

  const { data: statuses = [] } = useQuery<Status[]>({
    queryKey: ['statuses', values.projectId],
    queryFn: () => api.get(`/statuses?projectId=${values.projectId}`),
    enabled: open && !!values.projectId,
  })

  // Set synchronously (a ref, not state) whenever a fresh creation form is
  // reset below, and cleared once a default status has been assigned -
  // reading `values.statusId` itself for this instead would see a stale
  // pre-reset value on every open after the first (this component never
  // unmounts between opens - Modal just hides its children - so `values`
  // still holds the previous task's data at the moment this effect and
  // the one below run, before the reset's setValues has taken effect),
  // permanently blocking the default-status assignment and, in turn,
  // silently blocking every subsequent creation's submit (empty statusId
  // fails handleSubmit's guard with no error shown).
  const needsDefaultStatus = useRef(false)

  useEffect(() => {
    if (!open) return
    if (editing) {
      setValues({
        projectId: editing.projectId,
        statusId: editing.statusId,
        title: editing.title,
        description: editing.description ?? '',
        priority: editing.priority,
        dueDate: editing.dueDate ?? '',
        recurrenceInterval: editing.recurrenceInterval ?? '',
        recurrenceCount: String(editing.recurrenceCount ?? 1),
      })
      needsDefaultStatus.current = false
    } else {
      setValues(emptyForm(defaultProjectId ?? projects[0]?.id ?? ''))
      needsDefaultStatus.current = true
    }
    // Only re-run when the modal actually opens or the target task
    // changes - not on every projects/statuses refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, defaultProjectId])

  // Once a project is known (freshly opened, or the user just picked one)
  // and statuses have loaded, default statusId to the first non-done
  // column so a brand-new task never has to await the user picking one.
  useEffect(() => {
    if (!open || !needsDefaultStatus.current || statuses.length === 0) return
    const first = statuses.find((s) => !s.isDone) ?? statuses[0]
    if (first) {
      setValues((v) => ({ ...v, statusId: first.id }))
      needsDefaultStatus.current = false
    }
  }, [open, statuses])

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEditing ? api.put<Task>(`/tasks/${editing!.id}`, payload) : api.post<Task>('/tasks', payload),
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      toast.showSuccess(isEditing ? 'Задача обновлена' : 'Задача создана')
      onSaved?.(task)
      onClose()
    },
    onError: () => toast.showError('Не удалось сохранить задачу'),
  })

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!values.title.trim() || !values.projectId || !values.statusId) return

    const payload: Record<string, unknown> = {
      projectId: values.projectId,
      statusId: values.statusId,
      title: values.title.trim(),
      description: values.description.trim() || null,
      priority: values.priority,
      dueDate: values.dueDate || null,
      recurrenceInterval: values.recurrenceInterval || null,
      recurrenceCount: values.recurrenceInterval ? Number(values.recurrenceCount) || 1 : null,
    }
    if (!isEditing) payload['parentTaskId'] = defaultParentTaskId ?? null

    saveMutation.mutate(payload)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? 'Изменить задачу' : defaultParentTaskId ? 'Новая подзадача' : 'Новая задача'}
      icon={<ListTodo size={20} strokeWidth={2} />}
      actions={[{
        label: saveMutation.isPending ? 'Сохранение…' : 'Сохранить',
        onClick: () => (document.getElementById(TASK_FORM_ID) as HTMLFormElement | null)?.requestSubmit(),
        variant: 'primary',
      }]}
    >
      <form
        id={TASK_FORM_ID}
        onSubmit={handleSubmit}
        onKeyDown={handleArrowFieldNavigation}
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}
      >
        <Field
          id="task-title"
          label="Название"
          value={values.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder={TASK_TITLE_PLACEHOLDER}
        />

        <Field
          as="select"
          id="task-project"
          label="Проект"
          value={values.projectId}
          disabled={!!defaultProjectId || isEditing}
          onChange={(e) => set('projectId', e.target.value)}
        >
          {!values.projectId && <option value="">Выберите проект</option>}
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Field>

        <Field
          as="select"
          id="task-status"
          label="Статус"
          value={values.statusId}
          onChange={(e) => set('statusId', e.target.value)}
        >
          {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Field>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <div style={{ flex: 1 }}>
            <Field
              as="select"
              id="task-priority"
              label="Приоритет"
              value={values.priority}
              onChange={(e) => set('priority', e.target.value as Priority)}
            >
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <DateField
              id="task-due-date"
              label="Срок"
              value={values.dueDate}
              onChange={(v) => set('dueDate', v)}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="task-description-textarea">Описание</label>
          <textarea
            id="task-description-textarea"
            className="input"
            rows={3}
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            style={{ resize: 'vertical', fontFamily: 'var(--font-sans)' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <div style={{ flex: 1 }}>
            <Field
              as="select"
              id="task-recurrence"
              label="Повтор"
              value={values.recurrenceInterval}
              onChange={(e) => set('recurrenceInterval', e.target.value as FormValues['recurrenceInterval'])}
            >
              <option value="">Не повторяется</option>
              <option value="daily">Ежедневно</option>
              <option value="weekly">Еженедельно</option>
              <option value="monthly">Ежемесячно</option>
            </Field>
          </div>
          {values.recurrenceInterval && (
            <div style={{ flex: 1 }}>
              <Field
                id="task-recurrence-count"
                label="Каждые N"
                type="number"
                min={1}
                value={values.recurrenceCount}
                onChange={(e) => set('recurrenceCount', e.target.value)}
              />
            </div>
          )}
        </div>
      </form>
    </Modal>
  )
}
