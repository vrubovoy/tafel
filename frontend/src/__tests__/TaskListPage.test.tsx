import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskListPage } from '../features/tasks/TaskListPage'
import type { Task } from '../lib/types'

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
// Mock TanStack Router — TaskListPage reads `project` from useSearch, and
// links/navigates elsewhere via Link/useNavigate. `mockSearch` is mutated
// per-test to control what useSearch({ strict: false }) returns.
// ---------------------------------------------------------------------------
let mockSearch: Record<string, unknown> = {}
const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => mockSearch,
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/tasks' }),
  Link: (props: Record<string, unknown>) => {
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

const rootTask: Task = {
  id: 't-root', projectId: 'proj-1', parentTaskId: null, statusId: 'status-1',
  title: 'Root task', description: null, priority: 'medium', dueDate: null,
  sortOrder: 0, completedAt: null, recurrenceInterval: null, recurrenceCount: null,
  recurrenceAnchorDate: null, archived: false,
}
const childTask: Task = {
  id: 't-child', projectId: 'proj-1', parentTaskId: 't-root', statusId: 'status-1',
  title: 'Child task', description: null, priority: 'medium', dueDate: null,
  sortOrder: 0, completedAt: null, recurrenceInterval: null, recurrenceCount: null,
  recurrenceAnchorDate: null, archived: false,
}
const grandchildTask: Task = {
  id: 't-grandchild', projectId: 'proj-1', parentTaskId: 't-child', statusId: 'status-1',
  title: 'Grandchild task', description: null, priority: 'medium', dueDate: null,
  sortOrder: 0, completedAt: null, recurrenceInterval: null, recurrenceCount: null,
  recurrenceAnchorDate: null, archived: false,
}

const taskTree = [rootTask, childTask, grandchildTask]

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function mockApi(opts: { tasks?: Task[]; projects?: typeof projects }) {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/projects') return Promise.resolve(opts.projects ?? projects)
    if (path.startsWith('/tasks')) return Promise.resolve(opts.tasks ?? [])
    return Promise.resolve([])
  })
}

function commonAncestor(...elements: HTMLElement[]): HTMLElement {
  const chains = elements.map((el) => {
    const chain: HTMLElement[] = []
    let cur: HTMLElement | null = el
    while (cur) { chain.push(cur); cur = cur.parentElement }
    return chain
  })
  const [first, ...rest] = chains
  for (const el of first) {
    if (rest.every((chain) => chain.includes(el))) return el
  }
  throw new Error('no common ancestor found')
}

function isBefore(a: Node, b: Node): boolean {
  // eslint-disable-next-line no-bitwise
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
}

beforeEach(() => {
  vi.mocked(api.get).mockReset()
  vi.mocked(api.post).mockReset()
  vi.mocked(api.put).mockReset()
  vi.mocked(api.delete).mockReset()
  mockSearch = {}
  mockNavigate.mockReset()
})

// ---------------------------------------------------------------------------
// With a project selected: tree rendering
// ---------------------------------------------------------------------------
describe('TaskListPage with a project selected', () => {
  it('fetches tasks for that project and renders the full parent/child/grandchild tree, with the grandchild appearing exactly once', async () => {
    mockSearch = { project: 'proj-1' }
    mockApi({ tasks: taskTree })

    render(<TaskListPage />, { wrapper: createWrapper() })

    await screen.findByText('Root task')
    expect(screen.getByText('Child task')).toBeInTheDocument()
    expect(screen.getAllByText('Grandchild task')).toHaveLength(1)

    const tasksCall = vi.mocked(api.get).mock.calls.find(([p]) => String(p).startsWith('/tasks'))
    expect(tasksCall).toBeTruthy()
    expect(String(tasksCall![0])).toContain('proj-1')
  })

  it('collapsing the root task hides its descendants, and expanding it again restores them', async () => {
    mockSearch = { project: 'proj-1' }
    mockApi({ tasks: taskTree })
    const user = userEvent.setup()

    render(<TaskListPage />, { wrapper: createWrapper() })
    await screen.findByText('Root task')
    const rootEl = screen.getByText('Root task')
    const childEl = screen.getByText('Child task')
    const grandchildEl = screen.getByText('Grandchild task')
    const container = commonAncestor(rootEl, childEl, grandchildEl)

    // Root's own controls (collapse toggle among them) render before the
    // child's title in document order, since the children subtree nests
    // after the row's own header content.
    const candidates = within(container)
      .getAllByRole('button')
      .filter((btn) => isBefore(btn, childEl))
    expect(candidates.length).toBeGreaterThan(0)

    let collapseToggle: HTMLElement | null = null
    for (const btn of candidates) {
      if (!document.body.contains(btn)) continue
      await user.click(btn)
      if (screen.queryByText('Child task') === null) {
        collapseToggle = btn
        break
      }
      // Not the right control — put things back before trying the next one.
      if (document.body.contains(btn)) await user.click(btn)
    }

    expect(collapseToggle).toBeTruthy()
    expect(screen.queryByText('Child task')).not.toBeInTheDocument()
    expect(screen.queryByText('Grandchild task')).not.toBeInTheDocument()

    await user.click(collapseToggle as HTMLElement)
    expect(await screen.findByText('Child task')).toBeInTheDocument()
    expect(screen.getByText('Grandchild task')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Without a project selected
// ---------------------------------------------------------------------------
describe('TaskListPage with no project selected', () => {
  it('does not fetch a project-scoped tasks endpoint, does not crash, and does not render a task tree', async () => {
    mockSearch = {}
    mockApi({ projects })

    expect(() => render(<TaskListPage />, { wrapper: createWrapper() })).not.toThrow()

    await vi.waitFor(() => {
      // Give any effects a chance to run.
      expect(true).toBe(true)
    })

    const scopedTasksCall = vi.mocked(api.get).mock.calls.find(([p]) => {
      const s = String(p)
      return s.startsWith('/tasks') && /project(Id)?=proj-1/.test(s)
    })
    expect(scopedTasksCall).toBeUndefined()
    expect(screen.queryByText('Root task')).not.toBeInTheDocument()
  })

  it('shows some project-selection affordance instead', async () => {
    mockSearch = {}
    mockApi({ projects })

    render(<TaskListPage />, { wrapper: createWrapper() })

    await vi.waitFor(() => {
      const buttons = screen.queryAllByRole('button')
      const links = screen.queryAllByRole('link')
      const hasAffordance =
        [...buttons, ...links].some((el) => /проект|project/i.test(el.textContent ?? '')) ||
        screen.queryAllByText(/проект|project/i).length > 0
      expect(hasAffordance).toBe(true)
    })
  })
})

// ---------------------------------------------------------------------------
// New task action
// ---------------------------------------------------------------------------
describe('TaskListPage new task action', () => {
  it('opens the task creation modal (a recognizable title input appears) when a "new task" action is used', async () => {
    mockSearch = { project: 'proj-1' }
    mockApi({ tasks: [rootTask], projects })
    const user = userEvent.setup()

    render(<TaskListPage />, { wrapper: createWrapper() })
    await screen.findByText('Root task')

    const textboxesBefore = screen.queryAllByRole('textbox').length

    const trigger = [...screen.queryAllByRole('button')].find((btn) =>
      /добав|созда|new|нов.*задач|\+/i.test(btn.textContent ?? ''),
    )
    expect(trigger).toBeTruthy()
    await user.click(trigger as HTMLElement)

    await vi.waitFor(() => {
      expect(screen.getAllByRole('textbox').length).toBeGreaterThan(textboxesBefore)
    })
  })
})
