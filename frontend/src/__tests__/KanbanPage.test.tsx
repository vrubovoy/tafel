import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { KanbanPage } from '../features/kanban/KanbanPage'
import type { Task, Status } from '../lib/types'

const dndState = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => {
    dndState.props = props
    return <>{children}</>
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PointerSensor: class PointerSensor {},
  closestCenter: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn((...sensors: unknown[]) => sensors),
  useDroppable: vi.fn(() => ({ setNodeRef: vi.fn(), isOver: false })),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSortable: vi.fn(() => ({
    attributes: {}, listeners: {}, setNodeRef: vi.fn(), transform: null, isDragging: false,
  })),
  verticalListSortingStrategy: {},
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: { toString: vi.fn(() => undefined) },
    Translate: { toString: vi.fn(() => undefined) },
  },
}))

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
// Mock TanStack Router — KanbanPage reads `project`/`parent` from useSearch.
// ---------------------------------------------------------------------------
let mockSearch: Record<string, unknown> = {}
let mockLinkCalls: Array<Record<string, unknown>> = []

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => mockSearch,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/kanban' }),
  Link: (props: Record<string, unknown>) => {
    mockLinkCalls.push(props)
    const { to, children } = props as { to: unknown; children?: React.ReactNode }
    return <a href={typeof to === 'string' ? to : JSON.stringify(to)}>{children as React.ReactNode}</a>
  },
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const projects = [
  { id: 'proj-1', name: 'Personal', color: '#3b82f6', icon: 'home', sortOrder: 0, archived: false },
]

const statuses: Status[] = [
  { id: 'status-1', projectId: 'proj-1', name: 'To do', color: '#3b82f6', sortOrder: 0, isDone: false },
  { id: 'status-2', projectId: 'proj-1', name: 'Done', color: '#22c55e', sortOrder: 1, isDone: true },
]

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 't1', projectId: 'proj-1', parentTaskId: null, statusId: 'status-1',
    title: 'Task 1', description: null, priority: 'medium', dueDate: null,
    sortOrder: 0, completedAt: null, recurrenceInterval: null, recurrenceCount: null,
    recurrenceAnchorDate: null, archived: false,
    ...overrides,
  }
}

const topLevelTasks: Task[] = [
  makeTask({ id: 't1', title: 'Buy milk', statusId: 'status-1' }),
  makeTask({ id: 't2', title: 'Finish report', statusId: 'status-2' }),
]

const childTasks: Task[] = [
  makeTask({ id: 't3', title: 'Sub item', statusId: 'status-1', parentTaskId: 'task-1' }),
]

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function mockApi(opts: { tasks?: Task[]; allTasks?: Task[] }) {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/projects') return Promise.resolve(projects)
    if (path.startsWith('/statuses')) return Promise.resolve(statuses)
    if (path.startsWith('/tasks')) {
      return Promise.resolve(path.includes('parentTaskId=') ? (opts.tasks ?? []) : (opts.allTasks ?? opts.tasks ?? []))
    }
    return Promise.resolve([])
  })
}

beforeEach(() => {
  vi.mocked(api.get).mockReset()
  vi.mocked(api.post).mockReset()
  vi.mocked(api.put).mockReset()
  vi.mocked(api.delete).mockReset()
  mockSearch = {}
  mockLinkCalls = []
  dndState.props = null
})

// ---------------------------------------------------------------------------
// No project selected
// ---------------------------------------------------------------------------
describe('KanbanPage with no project selected', () => {
  it('renders a project picker (links per project) instead of a board', async () => {
    mockSearch = {}
    mockApi({})

    render(<KanbanPage />, { wrapper: createWrapper() })

    await screen.findByText('Personal')
    // No status columns should be rendered without a project.
    expect(screen.queryByText('To do')).not.toBeInTheDocument()
    expect(screen.queryByText('Done')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Project selected, top level
// ---------------------------------------------------------------------------
describe('KanbanPage with a project selected (top level)', () => {
  it('fetches statuses and tasks, rendering one column per status with tasks grouped by statusId', async () => {
    mockSearch = { project: 'proj-1' }
    mockApi({ tasks: topLevelTasks })

    render(<KanbanPage />, { wrapper: createWrapper() })

    await screen.findByText('To do')
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('Buy milk')).toBeInTheDocument()
    expect(screen.getByText('Finish report')).toBeInTheDocument()

    const statusesCall = vi.mocked(api.get).mock.calls.find(([p]) => String(p).startsWith('/statuses'))
    expect(statusesCall).toBeTruthy()
    expect(String(statusesCall![0])).toContain('proj-1')

    const tasksCall = vi.mocked(api.get).mock.calls.find(([p]) => String(p).startsWith('/tasks'))
    expect(tasksCall).toBeTruthy()
    expect(String(tasksCall![0])).toContain('proj-1')
    // Top-level view: parentTaskId filter present but empty.
    expect(String(tasksCall![0])).toMatch(/parentTaskId=(&|$)/)
  })

  it('rolls progress up through every descendant depth', async () => {
    mockSearch = { project: 'proj-1' }
    const root = makeTask({ id: 'root', title: 'Root task' })
    const child = makeTask({ id: 'child', title: 'Child', parentTaskId: root.id })
    const grandchild = makeTask({
      id: 'grandchild', title: 'Grandchild', parentTaskId: child.id, statusId: 'status-2',
    })
    mockApi({ tasks: [root], allTasks: [root, child, grandchild] })

    render(<KanbanPage />, { wrapper: createWrapper() })

    await screen.findByText('Root task')
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('persists a same-column drag using the target card position', async () => {
    mockSearch = { project: 'proj-1' }
    const first = makeTask({ id: 'first', title: 'First', sortOrder: 0 })
    const second = makeTask({ id: 'second', title: 'Second', sortOrder: 1 })
    mockApi({ tasks: [first, second] })
    vi.mocked(api.put).mockResolvedValue({ ...second, sortOrder: 0 })

    render(<KanbanPage />, { wrapper: createWrapper() })
    await screen.findByText('Second')

    await act(async () => {
      const onDragEnd = dndState.props?.onDragEnd as ((event: unknown) => void) | undefined
      expect(onDragEnd).toBeTypeOf('function')
      onDragEnd!({ active: { id: second.id }, over: { id: first.id } })
    })

    await vi.waitFor(() => {
      expect(api.put).toHaveBeenCalledWith(`/tasks/${second.id}/reorder`, {
        statusId: 'status-1', sortOrder: 0,
      })
    })
  })
})

// ---------------------------------------------------------------------------
// Project + parent selected (drill-down)
// ---------------------------------------------------------------------------
describe('KanbanPage with a project and parent task selected', () => {
  it('fetches tasks scoped to that parentTaskId and shows a breadcrumb/back-up affordance referencing the parent', async () => {
    mockSearch = { project: 'proj-1', parent: 'task-1' }
    mockApi({ tasks: childTasks })

    render(<KanbanPage />, { wrapper: createWrapper() })

    await screen.findByText('Sub item')

    const tasksCall = vi.mocked(api.get).mock.calls.find(([p]) => String(p).startsWith('/tasks'))
    expect(tasksCall).toBeTruthy()
    expect(String(tasksCall![0])).toContain('parentTaskId=task-1')

    // A breadcrumb-ish control mentioning the parent, or at least a
    // "back up" affordance, somewhere in the document.
    const hasBackUp =
      screen.queryAllByRole('link').some((el) => /kanban/i.test(el.getAttribute('href') ?? '') && !/task-1/.test(el.getAttribute('href') ?? '')) ||
      screen.queryAllByRole('button', { name: /назад|back|вверх|up/i }).length > 0
    expect(hasBackUp).toBe(true)
  })

  it('shows every ancestor in the breadcrumb and links each ancestor level', async () => {
    mockSearch = { project: 'proj-1', parent: 'grandchild' }
    const root = makeTask({ id: 'root', title: 'Root ancestor' })
    const child = makeTask({ id: 'child', title: 'Middle ancestor', parentTaskId: root.id })
    const grandchild = makeTask({ id: 'grandchild', title: 'Current parent', parentTaskId: child.id })
    mockApi({ tasks: [], allTasks: [root, child, grandchild] })

    render(<KanbanPage />, { wrapper: createWrapper() })

    await screen.findByText('Current parent')
    expect(screen.getByText('Root ancestor')).toBeInTheDocument()
    expect(screen.getByText('Middle ancestor')).toBeInTheDocument()
    expect(mockLinkCalls.some((props) => JSON.stringify(props.search).includes('root'))).toBe(true)
    expect(mockLinkCalls.some((props) => JSON.stringify(props.search).includes('child'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Manage-statuses ("gear") button
// ---------------------------------------------------------------------------
describe('KanbanPage manage-statuses button', () => {
  it('opens the manage-statuses UI when clicking the "Настроить колонки" button', async () => {
    mockSearch = { project: 'proj-1' }
    mockApi({ tasks: topLevelTasks })
    const user = userEvent.setup()

    render(<KanbanPage />, { wrapper: createWrapper() })

    await screen.findByText('To do')

    const manageButton = screen.getByRole('button', { name: /настроить.*колон/i })
    await user.click(manageButton)

    // The modal should now show each status name as an editable input's value.
    expect(await screen.findByDisplayValue('To do')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Done')).toBeInTheDocument()
  })
})
