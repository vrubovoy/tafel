import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Plus, FolderKanban, Archive, ArchiveRestore, Kanban } from 'lucide-react'
import { EmptyState, ICON_SIZE, Button, Field, Modal, Toast, handleArrowFieldNavigation } from '@zudar107/schloss-ui'
import { api } from '../../lib/api'
import { useToast } from '../../hooks/useToast'
import { HeroIllustration } from '../../components/HeroIllustration'

const PROJECT_FORM_ID = 'project-form'
const PROJECT_NAME_PLACEHOLDER = 'Личный сайт'
const DEFAULT_COLOR = '#f59e0b'

export interface Project {
  id: string
  name: string
  color: string
  icon: string
  sortOrder: number
  archived: boolean
}

interface ProjectFormValues {
  name: string
  color: string
}

const DEFAULT_FORM: ProjectFormValues = { name: '', color: DEFAULT_COLOR }

export function ProjectsPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => api.get('/projects'),
  })

  const createMutation = useMutation({
    mutationFn: (values: ProjectFormValues) => api.post('/projects', values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      closeModal()
      toast.showSuccess('Проект создан')
    },
    onError: () => toast.showError('Не удалось создать проект'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ProjectFormValues }) => api.put(`/projects/${id}`, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      closeModal()
      toast.showSuccess('Проект обновлён')
    },
    onError: () => toast.showError('Не удалось обновить проект'),
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      toast.showSuccess('Проект архивирован')
    },
    onError: () => toast.showError('Не удалось архивировать проект'),
  })

  function openCreate() {
    setEditing(null)
    setModalOpen(true)
  }

  function openEdit(project: Project) {
    setEditing(project)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditing(null)
  }

  function handleSubmit(values: ProjectFormValues) {
    if (editing) updateMutation.mutate({ id: editing.id, values })
    else createMutation.mutate(values)
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Проекты
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
            {projects.length} {projects.length === 1 ? 'проект' : 'проектов'}
          </p>
        </div>
        <Button variant="primary" style={{ fontSize: '0.8125rem', padding: '0.4rem 0.875rem' }} onClick={openCreate}>
          <Plus size={15} /> Новый проект
        </Button>
      </div>

      {isLoading ? null : projects.length === 0 ? (
        <EmptyState
          illustration={<HeroIllustration size={100} />}
          title="Проектов пока нет"
          description="Проект объединяет связанные задачи и задаёт свой набор колонок канбан-доски."
          actionLabel="Создать проект"
          actionIcon={<Plus size={16} />}
          onAction={openCreate}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onEdit={() => openEdit(p)} onArchive={() => archiveMutation.mutate(p.id)} />
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? 'Изменить проект' : 'Новый проект'}
        icon={<FolderKanban size={ICON_SIZE.default} strokeWidth={2} />}
        actions={[{
          label: (createMutation.isPending || updateMutation.isPending) ? 'Сохранение…' : 'Сохранить',
          onClick: () => (document.getElementById(PROJECT_FORM_ID) as HTMLFormElement | null)?.requestSubmit(),
          variant: 'primary',
        }]}
      >
        <ProjectForm
          formId={PROJECT_FORM_ID}
          initial={editing ? { name: editing.name, color: editing.color } : DEFAULT_FORM}
          onSubmit={handleSubmit}
        />
      </Modal>

      {toast.toast && (
        <Toast open variant={toast.toast.variant} message={toast.toast.message} onDismiss={toast.dismiss} />
      )}
    </div>
  )
}

function ProjectCard({ project, onEdit, onArchive }: {
  project: Project
  onEdit: () => void
  onArchive: () => void
}) {
  return (
    <div className="card" style={{ padding: '1.25rem', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: project.color, opacity: 0.8 }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: `${project.color}20`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: project.color,
          }}>
            <FolderKanban size={20} />
          </div>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{project.name}</div>
        </div>
        <Button variant="ghost" style={{ padding: '0.3rem', border: 'none' }} onClick={onArchive} aria-label="Архивировать проект">
          {project.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
        </Button>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <Link
          to="/kanban"
          search={{ project: project.id }}
          className="btn-primary"
          style={{ flex: 1, justifyContent: 'center', fontSize: '0.8125rem', textAlign: 'center' }}
        >
          <Kanban size={15} /> Доска
        </Link>
        <Button variant="ghost" style={{ fontSize: '0.8125rem', border: 'none' }} onClick={onEdit}>
          Изменить
        </Button>
      </div>
    </div>
  )
}

function ProjectForm({ formId, initial, onSubmit }: {
  formId: string
  initial: ProjectFormValues
  onSubmit: (values: ProjectFormValues) => void
}) {
  const [values, setValues] = useState(initial)

  function set<K extends keyof ProjectFormValues>(key: K, value: ProjectFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({ ...values, name: values.name.trim() || PROJECT_NAME_PLACEHOLDER })
  }

  return (
    <form
      id={formId}
      onSubmit={handleSubmit}
      onKeyDown={handleArrowFieldNavigation}
      noValidate
      style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}
    >
      <Field
        id="project-name"
        label="Название"
        value={values.name}
        onChange={(e) => set('name', e.target.value)}
        placeholder={PROJECT_NAME_PLACEHOLDER}
      />
      <Field
        id="project-color"
        label="Цвет"
        type="color"
        value={values.color}
        onChange={(e) => set('color', e.target.value)}
        style={{ padding: 2 }}
      />
    </form>
  )
}
