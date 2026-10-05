// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JournalEntryDetail } from './_types'

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  submit: vi.fn(),
  patch: vi.fn(),
  mutated: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  edit: null as null | ((html: string) => void),
}))
vi.mock('./_actions', () => ({
  updateEntry: mocks.update,
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
vi.mock('./_metadata-bar', () => ({ MetadataBar: () => null }))
vi.mock('./_photos', () => ({ Photos: () => null }))
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }))
vi.mock('next-intl', async (original) => ({
  ...(await original<typeof import('next-intl')>()),
  useLocale: () => 'en',
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
        onLocalPatch={mocks.patch}
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
  mocks.update.mockResolvedValue({ ok: true })
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
  it('drains the last debounced body edit before submitting and locking the draft', async () => {
    await render()
    await act(async () => mocks.edit!('<p>Final words</p>'))
    expect(mocks.update).not.toHaveBeenCalled()
    await act(async () => submitButton()!.click())
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      id: 'entry',
      patch: { bodyHtml: '<p>Final words</p>' },
    })
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith('entry')
    expect(mocks.patch).toHaveBeenCalledWith({ status: 'submitted', locked: true })
    expect(mocks.mutated).toHaveBeenCalledOnce()
  })
  it('keeps the draft editable if the submit action rejects', async () => {
    mocks.submit.mockRejectedValueOnce(new Error('Connection unavailable'))
    await render()
    await act(async () => submitButton()!.click())
    expect(mocks.error).toHaveBeenCalledWith('Connection unavailable')
    expect(mocks.patch).not.toHaveBeenCalledWith({ status: 'submitted', locked: true })
    expect(submitButton()!.disabled).toBe(false)
  })
})
