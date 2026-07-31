import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StatsPage } from '../features/stats/StatsPage'

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
// Fixtures
// ---------------------------------------------------------------------------
const summary = {
  totalTasks: 42,
  completedTasks: 30,
  completionRate: 0.7142857,
  overdueTasks: 3,
  currentStreak: 5,
  activeRecurringTasks: 2,
  tasksByProject: [
    { projectId: 'proj-1', name: 'Personal', color: '#3b82f6', total: 20, completed: 15 },
    { projectId: 'proj-2', name: 'Work', color: '#ef4444', total: 22, completed: 15 },
  ],
  completedLast14Days: [1, 2, 0, 3, 1, 0, 2, 4, 1, 0, 2, 3, 1, 2],
}

const emptySummary = {
  totalTasks: 0,
  completedTasks: 0,
  completionRate: 0,
  overdueTasks: 0,
  currentStreak: 0,
  activeRecurringTasks: 0,
  tasksByProject: [],
  completedLast14Days: Array(14).fill(0),
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function mockApiWithSummary(data: typeof summary) {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/stats/summary') return Promise.resolve(data)
    return Promise.reject(new Error(`Unexpected GET ${path}`))
  })
}

beforeEach(() => {
  vi.mocked(api.get).mockReset()
})

// ---------------------------------------------------------------------------
// Non-empty summary
// ---------------------------------------------------------------------------
describe('StatsPage with data', () => {
  it('renders numeric values from GET /stats/summary and each project name', async () => {
    mockApiWithSummary(summary)
    render(<StatsPage />, { wrapper: createWrapper() })

    await screen.findByText('Personal')
    expect(screen.getByText('Work')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/stats/summary')

    expect(screen.getAllByText((_, el) => (el?.textContent ?? '').includes('42')).length).toBeGreaterThan(0)
    expect(screen.getAllByText((_, el) => (el?.textContent ?? '').includes('30')).length).toBeGreaterThan(0)
    expect(screen.getAllByText((_, el) => (el?.textContent ?? '').includes('3')).length).toBeGreaterThan(0)
    expect(screen.getAllByText((_, el) => (el?.textContent ?? '').includes('5')).length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Empty summary (totalTasks: 0)
// ---------------------------------------------------------------------------
describe('StatsPage with totalTasks: 0', () => {
  it('renders an empty/no-data state rather than the stat tiles', async () => {
    mockApiWithSummary(emptySummary)
    render(<StatsPage />, { wrapper: createWrapper() })

    await vi.waitFor(() => expect(api.get).toHaveBeenCalledWith('/stats/summary'))

    await vi.waitFor(() => {
      const hasEmptyMessage =
        screen.queryAllByText(/нет данных|пока нет|no data|empty/i).length > 0
      expect(hasEmptyMessage).toBe(true)
    })
  })
})
