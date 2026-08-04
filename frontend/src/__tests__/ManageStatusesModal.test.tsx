import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ManageStatusesModal } from '../features/kanban/ManageStatusesModal'
import type { Status } from '../lib/types'

// ---------------------------------------------------------------------------
// Mock the api module (repo convention, see KanbanPage.test.tsx)
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
const statuses: Status[] = [
  { id: 's1', projectId: 'p1', name: 'To do', color: '#3b82f6', sortOrder: 0, isDone: false },
  { id: 's2', projectId: 'p1', name: 'Done', color: '#22c55e', sortOrder: 1, isDone: true },
]

type ModalProps = React.ComponentProps<typeof ManageStatusesModal>

function renderModal(overrides: Partial<ModalProps> = {}) {
  const onClose = vi.fn()
  const props: ModalProps = {
    open: true,
    onClose,
    projectId: 'p1',
    statuses,
    taskCountByStatus: new Map<string, number>(),
    ...overrides,
  }
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ManageStatusesModal {...props} />
    </QueryClientProvider>,
  )
  return { onClose, ...utils }
}

beforeEach(() => {
  vi.mocked(api.get).mockReset()
  vi.mocked(api.post).mockReset()
  vi.mocked(api.put).mockReset()
  vi.mocked(api.delete).mockReset()
  vi.mocked(api.post).mockResolvedValue({})
  vi.mocked(api.put).mockResolvedValue({})
  vi.mocked(api.delete).mockResolvedValue({})
})

// ---------------------------------------------------------------------------
// Rendering existing columns
// ---------------------------------------------------------------------------
describe('ManageStatusesModal - rendering', () => {
  it('renders each status name as an editable input value, and Done is checked while To do is not', () => {
    renderModal()

    const todoInput = screen.getByDisplayValue('To do')
    const doneInput = screen.getByDisplayValue('Done')
    expect(todoInput).toBeInTheDocument()
    expect(doneInput).toBeInTheDocument()

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    // Rendered in statuses array order (sortOrder 0, 1): To do, then Done.
    expect(checkboxes[0]).not.toBeChecked()
    expect(checkboxes[1]).toBeChecked()
  })
})

// ---------------------------------------------------------------------------
// Renaming
// ---------------------------------------------------------------------------
describe('ManageStatusesModal - renaming', () => {
  it('calls api.put with the new name only on blur, not on every keystroke', async () => {
    renderModal()
    const user = userEvent.setup()

    const todoInput = screen.getByDisplayValue('To do')
    await user.clear(todoInput)
    await user.type(todoInput, 'Backlog')

    expect(api.put).not.toHaveBeenCalled()

    await user.tab()

    expect(api.put).toHaveBeenCalledTimes(1)
    expect(api.put).toHaveBeenCalledWith('/statuses/s1', expect.objectContaining({ name: 'Backlog' }))
  })

  it('calls api.put with the new name on Enter', async () => {
    renderModal()
    const user = userEvent.setup()

    const todoInput = screen.getByDisplayValue('To do')
    await user.clear(todoInput)
    await user.type(todoInput, 'Backlog{Enter}')

    expect(api.put).toHaveBeenCalledWith('/statuses/s1', expect.objectContaining({ name: 'Backlog' }))
  })
})

// ---------------------------------------------------------------------------
// Toggling "done"
// ---------------------------------------------------------------------------
describe('ManageStatusesModal - toggling done', () => {
  it('calls api.put with isDone: true when checking an undone status', async () => {
    renderModal()
    const user = userEvent.setup()

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0]) // "To do", currently isDone: false

    expect(api.put).toHaveBeenCalledWith('/statuses/s1', expect.objectContaining({ isDone: true }))
  })

  it('calls api.put with isDone: false when unchecking a done status', async () => {
    renderModal()
    const user = userEvent.setup()

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1]) // "Done", currently isDone: true

    expect(api.put).toHaveBeenCalledWith('/statuses/s2', expect.objectContaining({ isDone: false }))
  })
})

// ---------------------------------------------------------------------------
// Changing color
// ---------------------------------------------------------------------------
describe('ManageStatusesModal - changing color', () => {
  it('calls api.put with the new color (using fireEvent, since userEvent struggles with color inputs)', async () => {
    renderModal()

    const colorInputs = document.querySelectorAll('input[type="color"]')
    expect(colorInputs.length).toBe(2)

    // React applies this particular input's change asynchronously (not
    // synchronously flushed within fireEvent's act() wrapper), so we
    // must wait for the resulting api.put call rather than asserting
    // immediately after fireEvent.change.
    fireEvent.change(colorInputs[0], { target: { value: '#ff0000' } })

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/statuses/s1', expect.objectContaining({ color: '#ff0000' }))
    })
  })
})

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------
describe('ManageStatusesModal - deleting', () => {
  it('deletes immediately (no confirmation UI) when the status has zero tasks', async () => {
    const taskCountByStatus = new Map([
      ['s1', 0],
      ['s2', 3],
    ])
    renderModal({ taskCountByStatus })
    const user = userEvent.setup()

    const deleteButtons = screen.getAllByRole('button', { name: /удал/i })
    await user.click(deleteButtons[0]) // s1 ("To do"), 0 tasks

    expect(api.delete).toHaveBeenCalledTimes(1)
    const [url] = vi.mocked(api.delete).mock.calls[0]
    expect(String(url)).toBe('/statuses/s1')
  })

  it('requires picking a target status and confirming before deleting a status that has tasks', async () => {
    const taskCountByStatus = new Map([
      ['s1', 0],
      ['s2', 3],
    ])
    renderModal({ taskCountByStatus })
    const user = userEvent.setup()

    const buttonCountBefore = screen.getAllByRole('button').length

    const deleteButtons = screen.getAllByRole('button', { name: /удал/i })
    await user.click(deleteButtons[1]) // s2 ("Done"), 3 tasks

    // Must not delete immediately.
    expect(api.delete).not.toHaveBeenCalled()

    // Some reassignment-picker UI should now be present (more controls than before).
    const buttonsAfter = screen.getAllByRole('button')
    expect(buttonsAfter.length).toBeGreaterThan(buttonCountBefore)

    // Confirm the deletion via whatever distinct confirm control appeared.
    const confirmCandidates = screen
      .getAllByRole('button')
      .filter((btn) => /подтверд|удал|delete|confirm/i.test(btn.textContent ?? '') || /подтверд|удал|delete|confirm/i.test(btn.getAttribute('aria-label') ?? ''))
    // The last matching button (most recently added / most specific) should be the confirm action.
    const confirmButton = confirmCandidates[confirmCandidates.length - 1]
    await user.click(confirmButton)

    expect(api.delete).toHaveBeenCalledTimes(1)
    const [url] = vi.mocked(api.delete).mock.calls[0]
    expect(String(url)).toContain('/statuses/s2')
    expect(String(url)).toContain('reassignTo=s1')
  })

  it('disables the delete control for the only remaining status and blocks the api call even via a raw click', () => {
    const singleStatus: Status[] = [
      { id: 's1', projectId: 'p1', name: 'Only', color: '#3b82f6', sortOrder: 0, isDone: true },
    ]
    renderModal({ statuses: singleStatus, taskCountByStatus: new Map([['s1', 0]]) })

    const deleteButton = screen.getByRole('button', { name: /удал/i })
    expect(deleteButton).toBeDisabled()

    fireEvent.click(deleteButton)

    expect(api.delete).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Adding a new column
// ---------------------------------------------------------------------------
describe('ManageStatusesModal - adding a column', () => {
  function getAddInput() {
    const textboxes = screen.getAllByRole('textbox')
    const addInput = textboxes.find((el) => (el as HTMLInputElement).value === '')
    if (!addInput) throw new Error('Could not find the empty "add column" text input')
    return addInput as HTMLInputElement
  }

  it('calls api.post with the typed name when adding a new column', async () => {
    renderModal()
    const user = userEvent.setup()

    const addInput = getAddInput()
    const addButton = screen.getByRole('button', { name: /добавить/i })

    await user.type(addInput, 'Review')
    await user.click(addButton)

    expect(api.post).toHaveBeenCalledWith('/statuses', expect.objectContaining({ projectId: 'p1', name: 'Review' }))
  })

  it('does not add a column with an empty or whitespace-only name', async () => {
    renderModal()
    const user = userEvent.setup()

    const addInput = getAddInput()
    const addButton = screen.getByRole('button', { name: /добавить/i })

    await user.type(addInput, '   ')

    if ((addButton as HTMLButtonElement).disabled) {
      expect(addButton).toBeDisabled()
    } else {
      await user.click(addButton)
      expect(api.post).not.toHaveBeenCalled()
    }
  })
})
