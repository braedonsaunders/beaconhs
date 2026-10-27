// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JournalEntryDetail } from './_types'

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  status: vi.fn(),
  synced: vi.fn(),
  mutated: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  change: vi.fn(),
  flush: vi.fn(),
  online: vi.fn(),
  provider: vi.fn(),
  isOnline: true,
  edit: null as null | ((html: string) => void),
}))
vi.mock('./_actions', () => ({
  submitEntry: mocks.submit,
  deleteEntry: vi.fn(),
  emailEntry: vi.fn(),
  unlockEntry: vi.fn(),
}))
vi.mock('./_editor', () => ({
  JournalEditor: ({ onChange }: { onChange: typeof mocks.edit }) => {
    mocks.edit = onChange
    return null
  },
}))
// The provider (device store + sync engine) has its own tests; here each field
// is a plain binding that adopts new server values like the real one.
vi.mock('@/lib/offline-drafts/offline-record', async () => {
  const { useEffect, useState } = await import('react')
  return {
    OfflineRecordProvider: ({ editable, children }: { editable: boolean; children: unknown }) => {
      mocks.provider(editable)
      return children
    },
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
        saveState: 'idle',
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
vi.mock('./_metadata-bar', () => ({ MetadataBar: () => null }))
vi.mock('./_photos', () => ({ Photos: () => null }))
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }))
vi.mock('next-intl', async (original) => ({
  ...(await original<typeof import('next-intl')>()),
  useLocale: () => 'en',
  useTimeZone: () => 'America/Toronto',
}))
vi.mock('@/i18n/generated', () => ({
  GeneratedText: ({ id }: { id: string }) => id,
  GeneratedValue: ({ value }: { value: unknown }) => value,
  useGeneratedTranslations: () => (value: string) => value,
  useGeneratedValueTranslations: () => (value: string) => value,
}))
import { EditorPane } from './_editor-pane'
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
  siteOrgUnitId: 'site',
  supervisorPersonId: 'supervisor',
  personId: 'person',
  createdByTenantUserId: 'member',
  tags: [],
  photos: [],
  authorName: 'Sam Rivera',
  siteName: 'North Site',
  supervisorName: 'Jordan Lee',
  updatedAt: '2026-10-05T12:00:00Z',
  submittedAt: null,
  locked: false,
  canEdit: true,
  canSubmit: true,
}
let root: Root
let container: HTMLDivElement
async function render(overrides: Partial<JournalEntryDetail> = {}) {
  await act(async () =>
    root.render(
      <EditorPane
        entry={{ ...entry, ...overrides }}
        tagSuggestions={[]}
        aiEnabled={false}
        onMutated={mocks.mutated}
        onDeleted={() => {}}
        onStatusChange={mocks.status}
        onSynced={mocks.synced}
        onBrowse={() => {}}
      />,
    ),
  )
}
function submitButton() {
  return container.querySelector<HTMLButtonElement>('[data-walkthrough="journals-submit"]')
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.isOnline = true
  mocks.flush.mockResolvedValue(undefined)
  mocks.submit.mockResolvedValue({ ok: true })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
describe('saved journal submit controls', () => {
  it('hides Submit on read-only drafts and already submitted entries', async () => {
    await render({ canEdit: false, canSubmit: false })
    expect(submitButton()).toBeNull()
    await render({ status: 'submitted', locked: true })
    expect(submitButton()).toBeNull()
  })
  it('blocks submission when the supervisor is missing', async () => {
    await render({ supervisorPersonId: null })
    expect(submitButton()!.disabled).toBe(true)
    await act(async () => submitButton()!.click())
    expect(mocks.submit).not.toHaveBeenCalled()
    await render({ supervisorPersonId: 'supervisor' })
    expect(submitButton()!.disabled).toBe(false)
  })
  it('blocks submission when the location is missing', async () => {
    await render({ siteOrgUnitId: null, siteName: null })
    expect(submitButton()!.disabled).toBe(true)
    await act(async () => submitButton()!.click())
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('pushes the queued body edit before submitting and locking the draft', async () => {
    await render()
    await act(async () => mocks.edit!('<p>Final words</p>'))
    expect(mocks.change).toHaveBeenCalledExactlyOnceWith('bodyHtml', '<p>Final words</p>')
    await act(async () => submitButton()!.click())
    expect(mocks.online).toHaveBeenCalledExactlyOnceWith('finish')
    expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.submit.mock.invocationCallOrder[0]!,
    )
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith('entry')
    expect(mocks.status).toHaveBeenCalledWith({ status: 'submitted', locked: true })
    expect(mocks.mutated).toHaveBeenCalledOnce()
  })
  it('does not submit without signal', async () => {
    mocks.isOnline = false
    await render()
    await act(async () => submitButton()!.click())
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(mocks.status).not.toHaveBeenCalled()
  })
  it('keeps the draft editable if the submit action rejects', async () => {
    mocks.submit.mockRejectedValueOnce(new Error('Connection unavailable'))
    await render()
    await act(async () => submitButton()!.click())
    expect(mocks.error).toHaveBeenCalledWith('Connection unavailable')
    expect(mocks.status).not.toHaveBeenCalledWith({ status: 'submitted', locked: true })
    expect(submitButton()!.disabled).toBe(false)
  })
  it('binds the entry to its offline record, editable only while an unlocked draft', async () => {
    await render()
    expect(mocks.provider).toHaveBeenLastCalledWith(true)
    await render({ status: 'submitted', locked: true })
    expect(mocks.provider).toHaveBeenLastCalledWith(false)
    await render({ canEdit: false })
    expect(mocks.provider).toHaveBeenLastCalledWith(false)
  })
})
