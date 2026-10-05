// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { flushRecordSaves } from '@/lib/pending-record-saves'
const mocks = vi.hoisted(() => ({ update: vi.fn(), refresh: vi.fn(), error: vi.fn() }))
vi.mock('./_actions', () => ({ updateDocumentMeta: mocks.update }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/lib/toast', () => ({ toast: { error: mocks.error } }))
vi.mock('@/i18n/generated', () => ({
  GeneratedText: ({ id }: { id: string }) => id,
  GeneratedValue: ({ value }: { value: unknown }) => value,
  useGeneratedTranslations: () => (value: string) => value,
  useGeneratedValueTranslations: () => (value: string) => value,
}))
import { DocumentOverview } from './_overview'
const initial = {
  title: 'Procedure',
  key: 'PROC',
  categoryId: '',
  typeId: '',
  description: '',
  reviewFrequencyMonths: '',
  nextReviewOn: '',
  showDocumentHeader: true,
  headerIssuedOn: '',
  headerRevisedOn: '',
  headerApprovedBy: '',
  headerVersionLabel: '',
}
let root: Root
let container: HTMLDivElement
beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
  vi.clearAllMocks()
  mocks.update.mockResolvedValue({ ok: true })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <DocumentOverview
        documentId="doc"
        initialMeta={initial}
        categories={[]}
        types={[]}
        hasMaster
      />,
    ),
  )
})
afterEach(async () => {
  mocks.update.mockResolvedValue({ ok: true })
  await act(async () => {
    await flushRecordSaves()
  })
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
async function edit(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('document header autosave', () => {
  it('saves every entered header field before PDF preview or publishing, without saving on open', async () => {
    expect(mocks.update).not.toHaveBeenCalled()
    await edit('o-issued', '2024-01-01')
    await edit('o-revised', '2026-09-01')
    await edit('o-approved', 'Peter Kazmierczak')
    await edit('o-version', 'Rev B')
    await act(async () => {
      await flushRecordSaves()
    })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        headerIssuedOn: '2024-01-01',
        headerRevisedOn: '2026-09-01',
        headerApprovedBy: 'Peter Kazmierczak',
        headerVersionLabel: 'Rev B',
      }),
    )
  })
  it('retains a rejected edit for visible retry', async () => {
    mocks.update.mockResolvedValueOnce({ ok: false, error: 'Connection lost' })
    await edit('o-approved', 'Peter')
    await act(async () => {
      await expect(flushRecordSaves()).rejects.toThrow('Connection lost')
    })
    expect(mocks.error).toHaveBeenCalledWith('Connection lost')
    expect(container.querySelector('button')!.textContent?.trim()).toBe('m_13b78c61dbb517')
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(mocks.update).toHaveBeenCalledTimes(2)
    expect(mocks.update.mock.calls[1]?.[0]).toMatchObject({ headerApprovedBy: 'Peter' })
  })
  it('persists edits when Overview unmounts before its debounce expires', async () => {
    await edit('o-version', '1.2')
    await act(async () => root.render(null))
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ headerVersionLabel: '1.2' }),
    )
  })
  it('waits for a newer header edit made during the active save', async () => {
    let finish!: (value: { ok: boolean }) => void
    mocks.update.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await edit('o-approved', 'First approver')
    const saving = flushRecordSaves()
    await edit('o-approved', 'Peter')
    await edit('o-version', 'Rev B')
    await act(async () => {
      finish({ ok: true })
      await saving
    })
    expect(mocks.update).toHaveBeenCalledTimes(2)
    expect(mocks.update.mock.calls[1]?.[0]).toMatchObject({
      headerApprovedBy: 'Peter',
      headerVersionLabel: 'Rev B',
    })
  })
})
