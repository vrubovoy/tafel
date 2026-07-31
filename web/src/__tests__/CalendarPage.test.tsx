import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CalendarPage } from '../features/calendar/CalendarPage'
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
// Mock TanStack Router
// ---------------------------------------------------------------------------
let mockSearch: Record<string, unknown> = {}

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => mockSearch,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/calendar' }),
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

const todayIso = new Date().toISOString().slice(0, 10)

const taskDueToday: Task = {
  id: 't1', projectId: 'proj-1', parentTaskId: null, statusId: 'status-1',
  title: 'Water the plants', description: null, priority: 'medium', dueDate: todayIso,
  sortOrder: 0, completedAt: null, recurrenceInterval: null, recurrenceCount: null,
  recurrenceAnchorDate: null, archived: false,
}

const weekdayLabels = [
  /пн|mon/i, /вт|tue/i, /ср|wed/i, /чт|thu/i, /пт|fri/i, /сб|sat/i, /вс|sun/i,
]

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function mockApi(opts: { tasks?: Task[] }) {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/projects') return Promise.resolve(projects)
    if (path.startsWith('/tasks')) return Promise.resolve(opts.tasks ?? [])
    return Promise.resolve([])
  })
}

beforeEach(() => {
  vi.mocked(api.get).mockReset()
  vi.mocked(api.post).mockReset()
  vi.mocked(api.put).mockReset()
  vi.mocked(api.delete).mockReset()
  mockSearch = {}
})

// ---------------------------------------------------------------------------
// No project selected
// ---------------------------------------------------------------------------
describe('CalendarPage with no project selected', () => {
  it('shows a project picker, not a grid', async () => {
    mockSearch = {}
    mockApi({})

    render(<CalendarPage />, { wrapper: createWrapper() })

    await screen.findByText('Personal')
    // None of the 7 weekday header labels should be present without a grid.
    const anyWeekday = weekdayLabels.some((re) => screen.queryAllByText(re).length > 0)
    expect(anyWeekday).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Project selected
// ---------------------------------------------------------------------------
describe('CalendarPage with a project selected', () => {
  it('renders a 7-column weekday header and shows a task on the cell matching its dueDate (today)', async () => {
    mockSearch = { project: 'proj-1' }
    mockApi({ tasks: [taskDueToday] })

    render(<CalendarPage />, { wrapper: createWrapper() })

    await screen.findByText('Water the plants')

    const matchedWeekdays = weekdayLabels.filter((re) => screen.queryAllByText(re).length > 0)
    expect(matchedWeekdays.length).toBe(7)
  })

  it('clicking a "next month" control requests a different date range from the API (or at least changes the displayed month/year label)', async () => {
    mockSearch = { project: 'proj-1' }
    mockApi({ tasks: [taskDueToday] })
    const user = userEvent.setup()

    render(<CalendarPage />, { wrapper: createWrapper() })
    await screen.findByText('Water the plants')

    const initialCallCount = vi.mocked(api.get).mock.calls.filter(([p]) => String(p).startsWith('/tasks')).length
    const initialTasksArgs = vi.mocked(api.get).mock.calls
      .filter(([p]) => String(p).startsWith('/tasks'))
      .map(([p]) => String(p))

    const nextButton = [...screen.queryAllByRole('button')].find((btn) =>
      /след|next|>/i.test(btn.textContent ?? '') || /след|next/i.test(btn.getAttribute('aria-label') ?? ''),
    )
    expect(nextButton).toBeTruthy()
    await user.click(nextButton as HTMLElement)

    await vi.waitFor(() => {
      const callsAfter = vi.mocked(api.get).mock.calls.filter(([p]) => String(p).startsWith('/tasks'))
      expect(callsAfter.length).toBeGreaterThan(initialCallCount)
      const newestArgs = callsAfter.map(([p]) => String(p))
      const changed = newestArgs.some((arg) => !initialTasksArgs.includes(arg))
      expect(changed).toBe(true)
    })
  })
})
