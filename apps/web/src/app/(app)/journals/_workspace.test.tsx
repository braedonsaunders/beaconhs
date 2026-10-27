// @vitest-environment jsdom
import { act, StrictMode, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Select } from '@beaconhs/ui'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JournalEntryDetail, WorkspaceData } from './_types'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  fetch: vi.fn(),
  workspace: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  change: vi.fn(),
  flush: vi.fn(),
  online: vi.fn(),
  isOnline: true,
  saveState: 'idle' as 'idle' | 'saved',
  shown: '',
  edit: null as null | ((html: string) => void),
}))
vi.mock('./_actions', () => ({
  createEntryForDate: mocks.create,
  fetchEntry: mocks.fetch,
  fetchWorkspace: mocks.workspace,
  fetchAuthorWorkspaceData: mocks.workspace,
  fetchTree: vi.fn(),
  fetchAuthorTree: vi.fn(),
  submitEntry: vi.fn(),
  deleteEntry: vi.fn(),
  emailEntry: vi.fn(),
  unlockEntry: vi.fn(),
}))
vi.mock('./_editor', () => ({
  JournalEditor: ({ value, onChange }: { value: string; onChange: typeof mocks.edit }) => {
    mocks.edit = onChange
    mocks.shown = value
    return <textarea aria-label="Journal text" />
  },
}))
// The provider (device store + sync engine) has its own tests; here each field
// is a plain binding. `mocks.saveState = 'saved'` makes the server acknowledge
// every edit.
vi.mock('@/lib/offline-drafts/offline-record', async () => {
  const { useEffect, useState } = await import('react')
  return {
    OfflineRecordProvider: ({ children }: { children: ReactNode }) => children,
    RecordSyncStatus: () => null,
    RecordSyncBanner: () => null,
    useRecordField: <T,>(fieldId: string, server: T) => {
      const [value, setValue] = useState(server)
      const serverKey = JSON.stringify(server)
      useEffect(() => setValue(JSON.parse(serverKey) as T), [serverKey])
      return {
        value,
        change: (next: T) => {
          setValue(next)
          mocks.change(fieldId, next)
        },
        commit: vi.fn(),
        saveState: mocks.saveState,
        error: null,
        retry: vi.fn(),
        paused: false,
      }
    },
  }
})
// Online-only steps: refused without signal, otherwise queued edits first.
vi.mock('@/lib/offline-drafts/use-online-action', () => ({
  useOnlineAction: () => async (purpose: string, run: () => Promise<void>) => {
    mocks.online(purpose)
    if (!mocks.isOnline) return false
    await mocks.flush()
    await run()
    return true
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
      <button onClick={() => onSelect('entry')}>Open first</button>
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
  useTimeZone: () => 'America/Toronto',
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
  authorName: 'Sam Rivera',
  siteName: null,
  supervisorName: null,
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
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent === text,
  )!
}
function quickDateButton(choice: string) {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((item) =>
    item.textContent?.startsWith(choice),
  )!
}
async function openDateChooser() {
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[data-walkthrough="journals-new-mobile"]')!.click(),
  )
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
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T01:00:00Z'))
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  mocks.create.mockResolvedValue({ ok: true, entry })
  mocks.fetch.mockResolvedValue({ ...entry, id: 'older', reference: 'J-older' })
  mocks.workspace.mockResolvedValue(data)
  mocks.flush.mockResolvedValue(undefined)
  mocks.isOnline = true
  mocks.saveState = 'idle'
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.history.replaceState(null, '', '/journals')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
function goOffline() {
  mocks.isOnline = false
  vi.stubGlobal('navigator', { ...navigator, onLine: false })
}
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
    expect(
      container.querySelector('[aria-label="Location (required for submission)"]'),
    ).not.toBeNull()
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
  it('pushes the last words before creating or resuming another date', async () => {
    await render(entry)
    const pushing = deferred<undefined>()
    mocks.flush.mockReturnValueOnce(pushing.promise)
    await act(async () => mocks.edit!('<p>Final words</p>'))
    expect(mocks.change).toHaveBeenCalledExactlyOnceWith('bodyHtml', '<p>Final words</p>')
    await act(async () => button('Open date').click())
    expect(mocks.online).toHaveBeenCalledWith('start')
    expect(mocks.create).not.toHaveBeenCalled()
    await act(async () => pushing.resolve(undefined))
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith('2026-10-04')
  })
  it('offers tomorrow in the viewer timezone without changing the current journal', async () => {
    await render(entry)
    await openDateChooser()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.querySelector<HTMLInputElement>('[aria-label="Journal date"]')!.value).toBe(
      '2026-10-06',
    )
    expect(quickDateButton('today').textContent).toContain('October 5, 2026')
    expect(quickDateButton('tomorrow').textContent).toContain('October 6, 2026')
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.change).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/journals')
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click(),
    )
    expect(mocks.create).not.toHaveBeenCalled()
    expect(container.textContent).toContain('J-1')
  })
  it('saves the current words before opening tomorrow and resumes its existing draft', async () => {
    await render(entry)
    const pushing = deferred<undefined>()
    mocks.flush.mockReturnValueOnce(pushing.promise)
    mocks.create.mockResolvedValueOnce({
      ok: true,
      entry: {
        ...entry,
        id: 'existing-tomorrow',
        reference: 'J-tomorrow',
        entryDate: '2026-10-06',
      },
    })
    await act(async () => mocks.edit!('<p>Today’s final words</p>'))
    await openDateChooser()
    await act(async () => quickDateButton('tomorrow').click())
    expect(mocks.create).not.toHaveBeenCalled()
    expect(container.textContent).toContain('J-1')
    expect(quickDateButton('tomorrow').disabled).toBe(true)
    await act(async () => pushing.resolve(undefined))
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith('2026-10-06')
    expect(mocks.change).toHaveBeenCalledExactlyOnceWith('bodyHtml', '<p>Today’s final words</p>')
    expect(window.location.pathname).toBe('/journals/existing-tomorrow')
    expect(container.textContent).toContain('J-tomorrow')
  })
  it('opens the selected future calendar date and does not accept a cleared date', async () => {
    await render(entry)
    await openDateChooser()
    const dateInput = document.querySelector<HTMLInputElement>('[aria-label="Journal date"]')!
    const setDate = async (value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          dateInput,
          value,
        )
        dateInput.dispatchEvent(new Event('input', { bubbles: true }))
      })
    await setDate('')
    expect(button('Open journal').disabled).toBe(true)
    await setDate('2027-01-02')
    expect(button('Open journal').disabled).toBe(false)
    await act(async () =>
      dateInput
        .closest('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
    )
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith('2027-01-02')
    expect(mocks.change).not.toHaveBeenCalled()
  })
  it('keeps the current entry and date chooser available if tomorrow cannot open offline', async () => {
    await render(entry)
    await openDateChooser()
    goOffline()
    await act(async () => quickDateButton('tomorrow').click())
    expect(mocks.create).not.toHaveBeenCalled()
    expect(container.textContent).toContain('J-1')
    expect(document.querySelector('[role="dialog"] [role="alert"]')!.textContent).toBe(
      'Could not open your journal.',
    )
    expect(mocks.change).not.toHaveBeenCalled()
  })
  it('shows creation failures in the date chooser and permits retry without discarding the current journal', async () => {
    await render(entry)
    mocks.create.mockResolvedValueOnce({ ok: false, error: 'Connection unavailable' })
    await openDateChooser()
    await act(async () => quickDateButton('tomorrow').click())
    expect(document.querySelector('[role="dialog"] [role="alert"]')!.textContent).toBe(
      'Connection unavailable',
    )
    expect(container.textContent).toContain('J-1')
    await act(async () => quickDateButton('tomorrow').click())
    expect(mocks.create).toHaveBeenCalledTimes(2)
  })
  it.each([{ canCreate: false }, { authorEntryId: 'author-record' }])(
    'hides the mobile create affordance from a read-only or author workspace %j',
    async (options) => {
      await render(entry, options)
      expect(container.querySelector('[data-walkthrough="journals-new-mobile"]')).toBeNull()
    },
  )
  it('switches back to an entry opened earlier without signal, with its synced edits', async () => {
    mocks.saveState = 'saved'
    await render(entry)
    await act(async () => mocks.edit!('<p>Synced words</p>'))
    await act(async () => button('Open older').click())
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith('older')
    expect(container.textContent).toContain('J-older')
    goOffline()
    await act(async () => button('Open first').click())
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(window.location.pathname).toBe('/journals/entry')
    expect(container.textContent).toContain('J-1')
    expect(mocks.shown).toBe('<p>Synced words</p>')
  })
  it('explains instead of opening an entry this device has not loaded without signal', async () => {
    await render(entry)
    goOffline()
    await act(async () => button('Open older').click())
    expect(mocks.online).toHaveBeenCalledExactlyOnceWith('start')
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(container.textContent).toContain('J-1')
  })
  it('leaves a retry instead of a skeleton when a new entry cannot start without signal', async () => {
    goOffline()
    await render()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-busy="true"]')).toBeNull()
    expect(container.querySelector('[role="alert"]')!.textContent).toBe(
      'Could not open your journal.',
    )
  })
})
