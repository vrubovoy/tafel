import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskFormModal } from '../features/tasks/TaskFormModal'
import type { Task, Status } from '../lib/types'

// ---------------------------------------------------------------------------
// Mock the api module
// ---------------------------------------------------------------------------
vi.mock('../lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

import { api } from '../lib/api'

// ---------------------------------------------------------------------------
// This modal has no router dependency per the spec (props-driven), so no
// @tanstack/react-router mock is needed here.
// ---------------------------------------------------------------------------

const statuses: Status[] = [
  { id: 'status-1', projectId: 'proj-1', name: 'To do', color: '#3b82f6', sortOrder: 0, isDone: false },
  { id: 'status-2', projectId: 'proj-1', name: 'Done', color: '#22c55e', sortOrder: 1, isDone: true },
]

const projects = [
  { id: 'proj-1', name: 'Personal', color: '#3b82f6', icon: 'home', sortOrder: 0, archived: false },
]

const existingTask: Task = {
  id: 't1', projectId: 'proj-1', parentTaskId: null, statusId: 'status-1',
  title: 'Existing', description: null, priority: 'medium', dueDate: null,
  sortOrder: 0, completedAt: null, recurrenceInterval: null, recurrenceCount: null,
  recurrenceAnchorDate: null, archived: false,
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function mockApiWithFixtures() {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith('/statuses')) return Promise.resolve(statuses)
    if (path === '/projects') return Promise.resolve(projects)
    return Promise.resolve([])
  })
}

beforeEach(() => {
  vi.mocked(api.get).mockReset()
  vi.mocked(api.post).mockReset()
  vi.mocked(api.put).mockReset()
  vi.mocked(api.delete).mockReset()
})

// ---------------------------------------------------------------------------
// Closed
// ---------------------------------------------------------------------------
describe('TaskFormModal when closed', () => {
  it('renders no form fields when open=false', () => {
    mockApiWithFixtures()
    render(
      <TaskFormModal open={false} onClose={vi.fn()} defaultProjectId="proj-1" editing={null} />,
      { wrapper: createWrapper() },
    )
    expect(screen.queryAllByRole('textbox').length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Open, creating a new task
// ---------------------------------------------------------------------------
describe('TaskFormModal when open, creating a new task', () => {
  it('shows an empty title field', async () => {
    mockApiWithFixtures()
    render(
      <TaskFormModal open={true} onClose={vi.fn()} defaultProjectId="proj-1" editing={null} />,
      { wrapper: createWrapper() },
    )
    const titleInput = await screen.findByRole('textbox', { name: /назв|title/i })
    expect((titleInput as HTMLInputElement).value).toBe('')
  })

  it('submitting a non-empty title calls api.post with projectId, title, and parentTaskId=null when defaultParentTaskId is undefined', async () => {
    mockApiWithFixtures()
    vi.mocked(api.post).mockResolvedValue({ ...existingTask, id: 't2', title: 'New task' })
    const onSaved = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(
      <TaskFormModal
        open={true}
        onClose={onClose}
        defaultProjectId="proj-1"
        editing={null}
        onSaved={onSaved}
      />,
      { wrapper: createWrapper() },
    )

    const titleInput = await screen.findByRole('textbox', { name: /назв|title/i })
    await user.type(titleInput, 'New task')

    const submitButton = screen.getByRole('button', { name: /сохран|созда|save|add/i })
    await user.click(submitButton)

    await vi.waitFor(() => expect(api.post).toHaveBeenCalled())
    const [path, body] = vi.mocked(api.post).mock.calls[0]
    expect(path).toBe('/tasks')
    expect((body as Record<string, unknown>).projectId).toBe('proj-1')
    expect((body as Record<string, unknown>).title).toBe('New task')
    expect((body as Record<string, unknown>).parentTaskId).toBeNull()

    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('submitting with an explicit defaultParentTaskId includes that id as parentTaskId', async () => {
    mockApiWithFixtures()
    vi.mocked(api.post).mockResolvedValue({ ...existingTask, id: 't3', title: 'Sub task', parentTaskId: 'parent-1' })
    const user = userEvent.setup()

    render(
      <TaskFormModal
        open={true}
        onClose={vi.fn()}
        defaultProjectId="proj-1"
        defaultParentTaskId="parent-1"
        editing={null}
      />,
      { wrapper: createWrapper() },
    )

    const titleInput = await screen.findByRole('textbox', { name: /назв|title/i })
    await user.type(titleInput, 'Sub task')

    const submitButton = screen.getByRole('button', { name: /сохран|созда|save|add/i })
    await user.click(submitButton)

    await vi.waitFor(() => expect(api.post).toHaveBeenCalled())
    const [, body] = vi.mocked(api.post).mock.calls[0]
    expect((body as Record<string, unknown>).parentTaskId).toBe('parent-1')
  })

  it('creating a task, closing, then reopening for a second creation still auto-assigns a default status and submits', async () => {
    // Regression test: this component never unmounts between opens (the
    // Modal it renders into just hides its children while TaskFormModal
    // itself stays mounted), so a second creation attempt in the same
    // session previously left statusId stuck empty - the default-status
    // effect's guard read a stale, already-assigned statusId from before
    // the reset had taken effect, so it never re-ran, and handleSubmit's
    // `!values.statusId` check silently blocked the submit with no error
    // shown.
    mockApiWithFixtures()
    vi.mocked(api.post)
      .mockResolvedValueOnce({ ...existingTask, id: 't2', title: 'First task' })
      .mockResolvedValueOnce({ ...existingTask, id: 't3', title: 'Second task' })
    const user = userEvent.setup()
    const onClose = vi.fn()

    const { rerender } = render(
      <TaskFormModal open={true} onClose={onClose} defaultProjectId="proj-1" editing={null} />,
      { wrapper: createWrapper() },
    )

    let titleInput = await screen.findByRole('textbox', { name: /назв|title/i })
    await user.type(titleInput, 'First task')
    await user.click(screen.getByRole('button', { name: /сохран|созда|save|add/i }))
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
    expect((vi.mocked(api.post).mock.calls[0]![1] as Record<string, unknown>).statusId).toBe('status-1')

    // Simulate the parent closing the modal, then reopening it for a
    // second creation - same mounted component tree throughout, exactly
    // like KanbanPage toggling its own formOpen state.
    rerender(<TaskFormModal open={false} onClose={onClose} defaultProjectId="proj-1" editing={null} />)
    rerender(<TaskFormModal open={true} onClose={onClose} defaultProjectId="proj-1" editing={null} />)

    titleInput = await screen.findByRole('textbox', { name: /назв|title/i })
    await user.type(titleInput, 'Second task')
    await user.click(screen.getByRole('button', { name: /сохран|созда|save|add/i }))
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(2))
    expect((vi.mocked(api.post).mock.calls[1]![1] as Record<string, unknown>).statusId).toBe('status-1')
  })

  it('does not call api.post when the title is empty or whitespace-only', async () => {
    mockApiWithFixtures()
    const user = userEvent.setup()

    render(
      <TaskFormModal open={true} onClose={vi.fn()} defaultProjectId="proj-1" editing={null} />,
      { wrapper: createWrapper() },
    )

    const titleInput = await screen.findByRole('textbox', { name: /назв|title/i })
    await user.type(titleInput, '   ')

    const submitButton = screen.getByRole('button', { name: /сохран|созда|save|add/i })
    await user.click(submitButton)

    // Give any async handlers a chance to run.
    await new Promise((r) => setTimeout(r, 50))
    expect(api.post).not.toHaveBeenCalled()
    expect(api.put).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Open, editing an existing task
// ---------------------------------------------------------------------------
describe('TaskFormModal when open, editing an existing task', () => {
  it('pre-fills the title field with the existing task title', async () => {
    mockApiWithFixtures()
    render(
      <TaskFormModal open={true} onClose={vi.fn()} defaultProjectId="proj-1" editing={existingTask} />,
      { wrapper: createWrapper() },
    )
    const titleInput = await screen.findByRole('textbox', { name: /назв|title/i })
    expect((titleInput as HTMLInputElement).value).toBe('Existing')
  })

  it('submitting calls api.put(`/tasks/t1`, ...) and not api.post', async () => {
    mockApiWithFixtures()
    vi.mocked(api.put).mockResolvedValue({ ...existingTask, title: 'Existing edited' })
    const onSaved = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()

    render(
      <TaskFormModal
        open={true}
        onClose={onClose}
        defaultProjectId="proj-1"
        editing={existingTask}
        onSaved={onSaved}
      />,
      { wrapper: createWrapper() },
    )

    const titleInput = await screen.findByRole('textbox', { name: /назв|title/i })
    await user.clear(titleInput)
    await user.type(titleInput, 'Existing edited')

    const submitButton = screen.getByRole('button', { name: /сохран|созда|save|add/i })
    await user.click(submitButton)

    await vi.waitFor(() => expect(api.put).toHaveBeenCalled())
    expect(api.post).not.toHaveBeenCalled()
    const [path] = vi.mocked(api.put).mock.calls[0]
    expect(path).toBe('/tasks/t1')

    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })
})
