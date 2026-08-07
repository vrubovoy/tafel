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

function mockApi(opts: { tasks?: Task[]; profile?: Record<string, unknown> | 'pending' }) {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/projects') return Promise.resolve(projects)
    if (path === '/users/me') {
      if (opts.profile === 'pending') return new Promise(() => {}) // never resolves
      if (opts.profile) return Promise.resolve(opts.profile)
      return Promise.resolve([])
    }
    if (path.startsWith('/tasks')) return Promise.resolve(opts.tasks ?? [])
    return Promise.resolve([])
  })
}

// Exact Russian weekday-abbreviation labels the header is expected to use,
// per the spec (Monday-start order). Used to derive DOM order below.
const mondayFirstLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const sundayFirstLabels = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

/**
 * Finds the exact-text weekday-abbreviation elements present in the
 * document and returns their labels ordered by DOM position (left-to-right
 * in a row reads as document order for a standard grid/flex header row).
 */
function getWeekdayHeaderOrder(): string[] {
  const allLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
  const found: { label: string; el: Element }[] = []
  for (const label of allLabels) {
    for (const el of screen.queryAllByText(label)) {
      found.push({ label, el })
    }
  }
  found.sort((a, b) =>
    a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  )
  return found.map((f) => f.label)
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

  it('keeps a date-only value on the same calendar day in the long modal label', async () => {
    const originalTimezone = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'

    try {
      mockSearch = { project: 'proj-1' }
      const now = new Date()
      const dueDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`
      const tasks = Array.from({ length: 4 }, (_, index): Task => ({
        ...taskDueToday,
        id: `long-label-${index}`,
        title: `Task ${index + 1}`,
        dueDate,
      }))
      mockApi({ tasks })
      const user = userEvent.setup()

      render(<CalendarPage />, { wrapper: createWrapper() })
      await user.click(await screen.findByRole('button', { name: '+1 ещё' }))

      const expected = new Date(now.getFullYear(), now.getMonth(), 15).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
      expect(screen.getByText(expected)).toBeInTheDocument()
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ
      else process.env.TZ = originalTimezone
    }
  })
})

// ---------------------------------------------------------------------------
// weekStartsOn from GET /users/me
// ---------------------------------------------------------------------------
describe('CalendarPage weekday header order based on weekStartsOn', () => {
  it('starts the header on Monday (Пн..Вс) when weekStartsOn is 1', async () => {
    mockSearch = { project: 'proj-1' }
    mockApi({ tasks: [taskDueToday], profile: { id: 'u1', email: 'a@a.com', name: 'A', weekStartsOn: 1 } })

    render(<CalendarPage />, { wrapper: createWrapper() })
    await screen.findByText('Water the plants')

    await vi.waitFor(() => {
      expect(getWeekdayHeaderOrder()).toEqual(mondayFirstLabels)
    })
  })

  it('starts the header on Sunday (Вс..Сб) when weekStartsOn is 0', async () => {
    mockSearch = { project: 'proj-1' }
    mockApi({ tasks: [taskDueToday], profile: { id: 'u1', email: 'a@a.com', name: 'A', weekStartsOn: 0 } })

    render(<CalendarPage />, { wrapper: createWrapper() })
    await screen.findByText('Water the plants')

    await vi.waitFor(() => {
      expect(getWeekdayHeaderOrder()).toEqual(sundayFirstLabels)
    })
  })

  it('still shows every day of the displayed month when weekStartsOn is 0', async () => {
    mockSearch = { project: 'proj-1' }
    mockApi({ tasks: [taskDueToday], profile: { id: 'u1', email: 'a@a.com', name: 'A', weekStartsOn: 0 } })

    render(<CalendarPage />, { wrapper: createWrapper() })
    await screen.findByText('Water the plants')

    const now = new Date()
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    // Day-of-month "1" and the last day of the month should both be present
    // regardless of which weekday the grid starts on.
    expect(screen.queryAllByText(String(1)).length).toBeGreaterThan(0)
    expect(screen.queryAllByText(String(daysInMonth)).length).toBeGreaterThan(0)
  })

  it('defaults to Monday-start while the /users/me fetch is still pending', async () => {
    mockSearch = { project: 'proj-1' }
    mockApi({ tasks: [taskDueToday], profile: 'pending' })

    render(<CalendarPage />, { wrapper: createWrapper() })
    await screen.findByText('Water the plants')

    expect(getWeekdayHeaderOrder()).toEqual(mondayFirstLabels)
  })

  it('defaults to Monday-start when /users/me resolves without a usable weekStartsOn', async () => {
    mockSearch = { project: 'proj-1' }
    mockApi({ tasks: [taskDueToday], profile: { id: 'u1', email: 'a@a.com', name: 'A' } })

    render(<CalendarPage />, { wrapper: createWrapper() })
    await screen.findByText('Water the plants')

    await vi.waitFor(() => {
      expect(getWeekdayHeaderOrder()).toEqual(mondayFirstLabels)
    })
  })
})
