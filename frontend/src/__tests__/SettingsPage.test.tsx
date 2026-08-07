import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SettingsPage } from '../features/settings/SettingsPage'

const sharedExportMocks = vi.hoisted(() => ({
  downloadJson: vi.fn(),
  directExportAction: vi.fn(),
}))

vi.mock('@zudar107/schloss-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zudar107/schloss-ui')>()
  return {
    ...actual,
    downloadJson: sharedExportMocks.downloadJson,
    DirectExportAction: (props: {
      title: string
      description: string
      actionLabel: string
      loadingLabel: string
      loading?: boolean
      onExport: () => void
    }) => {
      sharedExportMocks.directExportAction(props)
      return (
        <section>
          <h2>{props.title}</h2>
          <p>{props.description}</p>
          <button type="button" disabled={props.loading} onClick={props.onExport}>
            {props.loading ? props.loadingLabel : props.actionLabel}
          </button>
        </section>
      )
    },
  }
})

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

// weekStartsOnOverride mirrors weekStartsOn here (an explicit Tafel-level
// choice, not "following the platform default") - the select pre-selects
// off the override, not the resolved value, so these need to agree for
// the "pre-selects X" tests below to mean what they say.
const profile = { id: 'user-1', email: 'ivan@example.com', name: 'Иван Петров', weekStartsOn: 1, weekStartsOnOverride: 1 as 0 | 1 | null }

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
  sharedExportMocks.downloadJson.mockReset()
  sharedExportMocks.directExportAction.mockClear()
})

describe('SettingsPage', () => {
  it('fetches GET /users/me and renders both the name and email as text', async () => {
    mockApiWithProfile(profile)
    render(<SettingsPage />, { wrapper: createWrapper() })

    await screen.findByText('Иван Петров')
    expect(screen.getByText('ivan@example.com')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/users/me')
  })

  it('keeps direct export using the shared action and JSON download helper', async () => {
    const exportedData = {
      version: '1',
      service: 'tafel',
      exportedAt: '2026-08-07T12:00:00.000Z',
      data: { weekStartsOn: null, projects: [], statuses: [], tasks: [] },
    }
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === '/users/me') return Promise.resolve(profile)
      if (path === '/exports/me') return Promise.resolve(exportedData)
      return Promise.reject(new Error(`Unexpected GET ${path}`))
    })
    const user = userEvent.setup()

    render(<SettingsPage />, { wrapper: createWrapper() })
    await screen.findByText('Иван Петров')
    await user.click(screen.getByRole('button', { name: /экспортировать данные/i }))

    await vi.waitFor(() => expect(api.get).toHaveBeenCalledWith('/exports/me'))
    expect(sharedExportMocks.directExportAction).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringMatching(/данн|экспорт/i),
      description: expect.stringMatching(/json|проект|задач/i),
      onExport: expect.any(Function),
    }))
    expect(sharedExportMocks.downloadJson).toHaveBeenCalledWith(
      exportedData,
      expect.stringMatching(/^tafel-export-\d{4}-\d{2}-\d{2}\.json$/),
    )
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
    mockApiWithProfile({ ...profile, weekStartsOn: 1, weekStartsOnOverride: 1 })
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
    mockApiWithProfile({ ...profile, weekStartsOn: 0, weekStartsOnOverride: 0 })
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
