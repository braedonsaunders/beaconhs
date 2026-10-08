// @vitest-environment jsdom
import { act, StrictMode, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Select } from '@beaconhs/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JournalEntryDetail, WorkspaceData } from './_types'
import { flushRecordSaves } from '@/lib/pending-record-saves'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  fetch: vi.fn(),
  workspace: vi.fn(),
  update: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  edit: null as null | ((html: string) => void),
}))
vi.mock('./_actions', () => ({
  createEntryForDate: mocks.create,
  fetchEntry: mocks.fetch,
  fetchWorkspace: mocks.workspace,
  fetchAuthorWorkspaceData: mocks.workspace,
  fetchTree: vi.fn(),
  fetchAuthorTree: vi.fn(),
  updateEntry: mocks.update,
  submitEntry: vi.fn(),
  deleteEntry: vi.fn(),
  emailEntry: vi.fn(),
  unlockEntry: vi.fn(),
}))
vi.mock('./_editor', () => ({
  JournalEditor: ({ onChange }: { onChange: typeof mocks.edit }) => {
    mocks.edit = onChange
    return <textarea aria-label="Journal text" />
  },
}))
vi.mock('./_photos', () => ({ Photos: () => null }))
vi.mock('./_sidebar-tree', () => ({
  SidebarTree: ({
    onSelect,
    onPickDate,
  }: {
    onSelect: (id: string) => void
    onPickDate: (date: string) => void
  }) => (
    <>
      <button onClick={() => onSelect('older')}>Open older</button>
      <button onClick={() => onPickDate('2026-10-04')}>Open date</button>
    </>
  ),
}))
vi.mock('@beaconhs/ui', async (original) => ({
  ...(await original<typeof import('@beaconhs/ui')>()),
  SearchSelect: ({
    ariaLabel,
    value,
    disabled,
    onChange,
    options,
  }: {
    ariaLabel: string
    value: string
    disabled: boolean
    onChange: (value: string) => void
    options: { value: string; label: string }[]
  }) => (
    <Select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  ),
}))
vi.mock('@/components/remote-search-select', () => ({
  RemoteSearchSelect: ({
    ariaLabel,
    value,
    disabled,
  }: {
    ariaLabel: string
    value: string
    disabled: boolean
  }) => (
    <Select aria-label={ariaLabel} value={value} disabled={disabled} onChange={() => {}}>
      <option value="">None</option>
      <option value="supervisor">Supervisor</option>
    </Select>
  ),
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }))
vi.mock('next-intl', async (original) => ({
  ...(await original<typeof import('next-intl')>()),
  useLocale: () => 'en',
}))
vi.mock('@/i18n/generated', () => ({
  GeneratedText: ({ id }: { id: string }) => id,
  GeneratedValue: ({ value }: { value: ReactNode }) => value,
  useGeneratedTranslations: () => (value: string) => value,
  useGeneratedValueTranslations: () => (value: string) => value,
}))
import { JournalWorkspace } from './_workspace'

const entry: JournalEntryDetail = {
  id: 'entry',
  reference: 'J-1',
  title: null,
  bodyHtml: '',
  bodyText: '',
  summary: null,
  entryDate: '2026-10-05',
  status: 'draft',
  definition: 'worker',
  siteOrgUnitId: null,
  supervisorPersonId: null,
  personId: 'person',
  createdByTenantUserId: 'member',
  tags: [],
  photos: [],
  authorName: 'Evan Saunders',
  siteName: null,
  updatedAt: '2026-10-05T12:00:00Z',
  submittedAt: null,
  locked: false,
  canEdit: true,
  canSubmit: true,
}
const data: WorkspaceData = {
  tree: [],
  treeHasMore: false,
  treeNextCursor: null,
  heatmap: [],
  counts: { total: 0, drafts: 0 },
  tagSuggestions: [],
  canReadAll: false,
  canBrowseAll: false,
  canManage: false,
  canCreate: true,
  aiEnabled: false,
}
let root: Root
let container: HTMLDivElement
async function render(
  initialEntry: JournalEntryDetail | null = null,
  options: { canCreate?: boolean; authorEntryId?: string } = {},
) {
  await act(async () =>
    root.render(
      <StrictMode>
        <JournalWorkspace
          initialData={{ ...data, canCreate: options.canCreate ?? true }}
          initialEntry={initialEntry}
          initialGroupBy="date"
          authorEntryId={options.authorEntryId}
        />
      </StrictMode>,
    ),
  )
}
function button(text: string) {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent === text,
  )!
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  mocks.create.mockResolvedValue({ ok: true, entry })
  mocks.fetch.mockResolvedValue({ ...entry, id: 'older', reference: 'J-older' })
  mocks.workspace.mockResolvedValue(data)
  mocks.update.mockResolvedValue({ ok: true })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.history.replaceState(null, '', '/journals')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => {
    await flushRecordSaves()
    root.unmount()
  })
  container.remove()
  vi.unstubAllGlobals()
})
describe('one journal editor', () => {
  it('creates once on arrival, then immediately shows the actual full editor without typing', async () => {
    const opening = deferred<{ ok: true; entry: JournalEntryDetail }>()
    mocks.create.mockReturnValue(opening.promise)
    await render()
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(undefined)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.querySelector('textarea')).toBeNull()
    await act(async () => opening.resolve({ ok: true, entry }))
    expect(container.querySelector('input[type="date"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Log type"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Location"]')).not.toBeNull()
    expect(
      container.querySelector('[aria-label="Supervisor (required for submission)"]'),
    ).not.toBeNull()
    expect(container.querySelector('textarea')).not.toBeNull()
    expect(
      container.querySelector<HTMLButtonElement>('[data-walkthrough="journals-submit"]')!.disabled,
    ).toBe(true)
    expect(window.location.pathname).toBe('/journals/entry')
    expect(mocks.success).not.toHaveBeenCalled()
  })
  it('opens an existing entry without creating a replacement', async () => {
    await render(entry)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(container.querySelector('textarea')).not.toBeNull()
  })
  it.each([{ canCreate: false }, { authorEntryId: 'author-record' }])(
    'does not create from a read-only workspace %j',
    async (options) => {
      await render(null, options)
      expect(mocks.create).not.toHaveBeenCalled()
      expect(container.querySelector('[aria-busy="true"]')).toBeNull()
    },
  )
  it('shows a real failure and retries opening instead of accepting unsaved text', async () => {
    mocks.create.mockResolvedValueOnce({ ok: false, error: 'Connection unavailable' })
    await render()
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('Connection unavailable')
    expect(container.querySelector('textarea')).toBeNull()
    await act(async () => button('Retry opening journal').click())
    expect(mocks.create).toHaveBeenCalledTimes(2)
    expect(container.querySelector('textarea')).not.toBeNull()
  })
  it('preserves an explicitly selected journal when automatic opening finishes later', async () => {
    const opening = deferred<{ ok: true; entry: JournalEntryDetail }>()
    mocks.create.mockReturnValue(opening.promise)
    await render()
    await act(async () => button('Open older').click())
    expect(window.location.pathname).toBe('/journals/older')
    await act(async () => opening.resolve({ ok: true, entry }))
    expect(window.location.pathname).toBe('/journals/older')
    expect(container.textContent).toContain('J-older')
  })
  it('retains a recoverable error if selecting a journal fails during automatic opening', async () => {
    const opening = deferred<{ ok: true; entry: JournalEntryDetail }>()
    mocks.create.mockReturnValue(opening.promise)
    await render()
    mocks.fetch.mockRejectedValueOnce(new Error('Connection unavailable'))
    await act(async () => button('Open older').click())
    await act(async () => opening.resolve({ ok: true, entry }))
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('Connection unavailable')
    await act(async () => button('Retry opening journal').click())
    expect(container.querySelector('textarea')).not.toBeNull()
  })
  it('saves the last words before creating or resuming another date', async () => {
    await render(entry)
    const saving = deferred<{ ok: true }>()
    mocks.update.mockReturnValueOnce(saving.promise)
    await act(async () => mocks.edit!('<p>Final words</p>'))
    await act(async () => button('Open date').click())
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      id: 'entry',
      patch: { bodyHtml: '<p>Final words</p>' },
    })
    await act(async () => saving.resolve({ ok: true }))
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith('2026-10-04')
  })
})
