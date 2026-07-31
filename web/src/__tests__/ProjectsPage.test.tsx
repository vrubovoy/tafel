import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProjectsPage } from '../features/projects/ProjectsPage'

// ---------------------------------------------------------------------------
// Mock the api module — same convention as kuvert's SettingsPage.test.tsx /
// DocsPage.test.tsx.
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
// Mock TanStack Router — ProjectsPage links each project card to its kanban
// board via <Link to="..." search={{...}}>. Link is mocked to a plain <a>
// (same mechanical pattern as kuvert's Layout.test.tsx), and every render's
// props are also recorded so tests can assert on the raw `to`/`search`
// props directly instead of relying on a real navigation happening.
// ---------------------------------------------------------------------------
let mockLinkCalls: Array<Record<string, unknown>> = []

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/projects' }),
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
  { id: 'proj-2', name: 'Work', color: '#ef4444', icon: 'briefcase', sortOrder: 1, archived: false },
]

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

function mockProjectsList(list: typeof projects) {
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path === '/projects') return Promise.resolve(list)
    return Promise.reject(new Error(`Unexpected GET ${path}`))
  })
}

// A generic "some element inviting an action roughly matching this" helper —
// deliberately not asserting on exact copy, per spec.
function findByLooseName(regex: RegExp): HTMLElement[] {
  const buttons = screen.queryAllByRole('button')
  const links = screen.queryAllByRole('link')
  return [...buttons, ...links].filter((el) => regex.test(el.textContent ?? ''))
}

beforeEach(() => {
  vi.mocked(api.get).mockReset()
  vi.mocked(api.post).mockReset()
  vi.mocked(api.put).mockReset()
  vi.mocked(api.delete).mockReset()
  mockLinkCalls = []
})

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------
describe('ProjectsPage listing', () => {
  it('fetches GET /projects and renders each project name', async () => {
    mockProjectsList(projects)
    render(<ProjectsPage />, { wrapper: createWrapper() })

    await screen.findByText('Personal')
    expect(screen.getByText('Work')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/projects')
  })

  it('shows a create-a-project affordance when there are zero projects', async () => {
    mockProjectsList([])
    render(<ProjectsPage />, { wrapper: createWrapper() })

    await vi.waitFor(() => {
      expect(findByLooseName(/созда|добав|new|нов.*проект|проект/i).length).toBeGreaterThan(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Kanban links
// ---------------------------------------------------------------------------
describe('ProjectsPage kanban links', () => {
  it('links each project card to the kanban board for that project', async () => {
    mockProjectsList(projects)
    render(<ProjectsPage />, { wrapper: createWrapper() })
    await screen.findByText('Personal')

    // Every recorded Link render whose `to` (as string) or `search` (object,
    // stringified) reference /kanban together with a project id.
    const kanbanLinks = mockLinkCalls.filter((props) => {
      const to = JSON.stringify(props.to ?? '')
      const search = JSON.stringify(props.search ?? '')
      return /kanban/.test(to) || /kanban/.test(search)
    })
    expect(kanbanLinks.length).toBeGreaterThan(0)

    const proj1Link = kanbanLinks.find((props) => {
      const to = JSON.stringify(props.to ?? '')
      const search = JSON.stringify(props.search ?? '')
      return to.includes('proj-1') || search.includes('proj-1')
    })
    expect(proj1Link).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Creating a project
// ---------------------------------------------------------------------------
describe('ProjectsPage create flow', () => {
  it('opens a form with at least a name field when the "new project" affordance is clicked, and submitting calls api.post with the entered name', async () => {
    mockProjectsList(projects)
    vi.mocked(api.post).mockResolvedValue({ id: 'proj-3', name: 'New Project', color: '#000000', icon: 'star', sortOrder: 2, archived: false })
    const user = userEvent.setup()

    render(<ProjectsPage />, { wrapper: createWrapper() })
    await screen.findByText('Personal')

    const trigger = findByLooseName(/созда|добав|new|нов.*проект/i)[0]
    expect(trigger).toBeTruthy()
    await user.click(trigger)

    const textboxes = await vi.waitFor(() => {
      const boxes = screen.getAllByRole('textbox')
      expect(boxes.length).toBeGreaterThan(0)
      return boxes
    })

    const nameInput = textboxes[0]
    await user.clear(nameInput)
    await user.type(nameInput, 'My New Project')

    const submitCandidates = [...screen.queryAllByRole('button')].filter((btn) =>
      /созда|сохран|save|добав|submit|ok/i.test(btn.textContent ?? ''),
    )
    const submitButton = submitCandidates[submitCandidates.length - 1]
    expect(submitButton).toBeTruthy()
    await user.click(submitButton)

    await vi.waitFor(() => {
      expect(api.post).toHaveBeenCalled()
    })
    const [path, body] = vi.mocked(api.post).mock.calls[0]
    expect(path).toBe('/projects')
    expect((body as { name: string }).name).toBe('My New Project')
  })
})

// ---------------------------------------------------------------------------
// Archiving a project
// ---------------------------------------------------------------------------
describe('ProjectsPage archive action', () => {
  it('calls api.delete(`/projects/${id}`) when the archive action for a project is used', async () => {
    mockProjectsList(projects)
    vi.mocked(api.delete).mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<ProjectsPage />, { wrapper: createWrapper() })
    const card = (await screen.findByText('Personal')).closest('*') as HTMLElement

    // Look for an archive-labeled control anywhere in the document first
    // (scoping to the card if we can find a sensible container), matching
    // loosely on "архив" (Russian for "archive") or "archive".
    let root: HTMLElement = document.body
    let el: HTMLElement | null = card
    while (el) {
      const btn = within(el).queryByRole('button', { name: /архив|archive/i })
      if (btn) { root = el; break }
      el = el.parentElement
    }
    const archiveButton = within(root).getAllByRole('button', { name: /архив|archive/i })[0]
    expect(archiveButton).toBeTruthy()
    await user.click(archiveButton)

    await vi.waitFor(() => {
      expect(api.delete).toHaveBeenCalled()
    })
    expect(vi.mocked(api.delete).mock.calls[0][0]).toMatch(/\/projects\/proj-/)
  })
})
