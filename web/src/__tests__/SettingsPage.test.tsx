import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SettingsPage } from '../features/settings/SettingsPage'

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

const profile = { id: 'user-1', email: 'ivan@example.com', name: 'Иван Петров' }

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function mockApiWithProfile(p: typeof profile) {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/users/me') return Promise.resolve(p)
    return Promise.reject(new Error(`Unexpected GET ${path}`))
  })
}

beforeEach(() => {
  vi.mocked(api.get).mockReset()
})

describe('SettingsPage', () => {
  it('fetches GET /users/me and renders both the name and email as text', async () => {
    mockApiWithProfile(profile)
    render(<SettingsPage />, { wrapper: createWrapper() })

    await screen.findByText('Иван Петров')
    expect(screen.getByText('ivan@example.com')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/users/me')
  })
})
