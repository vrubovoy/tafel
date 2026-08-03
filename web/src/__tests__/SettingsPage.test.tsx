import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

const profile = { id: 'user-1', email: 'ivan@example.com', name: 'Иван Петров', weekStartsOn: 1 }

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
  vi.mocked(api.put).mockReset()
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

// ---------------------------------------------------------------------------
// Week-start selector
// ---------------------------------------------------------------------------
function findWeekStartSelect(): HTMLSelectElement {
  const combo = screen.getByRole('combobox', { name: /начало недели|недел/i })
  return combo as HTMLSelectElement
}

function findSaveButton(): HTMLElement {
  const candidates = [...screen.queryAllByRole('button')].filter((btn) =>
    /сохран|save/i.test(btn.textContent ?? ''),
  )
  return candidates[candidates.length - 1]
}

describe('SettingsPage week-start selector', () => {
  it('pre-selects "Понедельник" when the fetched profile has weekStartsOn: 1', async () => {
    mockApiWithProfile({ ...profile, weekStartsOn: 1 })
    render(<SettingsPage />, { wrapper: createWrapper() })

    await screen.findByText('Иван Петров')
    const select = findWeekStartSelect()
    await vi.waitFor(() => {
      expect(select.value).toMatch(/понедельник|1/i)
    })
    const selectedOption = select.selectedOptions[0]
    expect(selectedOption.textContent).toMatch(/понедельник/i)
  })

  it('pre-selects "Воскресенье" when the fetched profile has weekStartsOn: 0', async () => {
    mockApiWithProfile({ ...profile, weekStartsOn: 0 })
    render(<SettingsPage />, { wrapper: createWrapper() })

    await screen.findByText('Иван Петров')
    const select = findWeekStartSelect()
    await vi.waitFor(() => {
      const selectedOption = select.selectedOptions[0]
      expect(selectedOption.textContent).toMatch(/воскресенье/i)
    })
  })

  it('changing the selection to "Воскресенье" and submitting calls api.put with /users/me and { weekStartsOn: 0 }', async () => {
    mockApiWithProfile({ ...profile, weekStartsOn: 1 })
    vi.mocked(api.put).mockResolvedValue({ ...profile, weekStartsOn: 0 })
    const user = userEvent.setup()

    render(<SettingsPage />, { wrapper: createWrapper() })
    await screen.findByText('Иван Петров')

    const select = findWeekStartSelect()
    await user.selectOptions(select, 'Воскресенье')

    const saveButton = findSaveButton()
    expect(saveButton).toBeTruthy()
    await user.click(saveButton)

    await vi.waitFor(() => expect(api.put).toHaveBeenCalled())
    const [path, body] = vi.mocked(api.put).mock.calls[0]
    expect(path).toBe('/users/me')
    expect(body).toEqual({ weekStartsOn: 0 })
  })

  it('changing the selection to "Понедельник" and submitting calls api.put with /users/me and { weekStartsOn: 1 }', async () => {
    mockApiWithProfile({ ...profile, weekStartsOn: 0 })
    vi.mocked(api.put).mockResolvedValue({ ...profile, weekStartsOn: 1 })
    const user = userEvent.setup()

    render(<SettingsPage />, { wrapper: createWrapper() })
    await screen.findByText('Иван Петров')

    const select = findWeekStartSelect()
    await user.selectOptions(select, 'Понедельник')

    const saveButton = findSaveButton()
    expect(saveButton).toBeTruthy()
    await user.click(saveButton)

    await vi.waitFor(() => expect(api.put).toHaveBeenCalled())
    const [path, body] = vi.mocked(api.put).mock.calls[0]
    expect(path).toBe('/users/me')
    expect(body).toEqual({ weekStartsOn: 1 })
  })
})
