// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ confirm: vi.fn(), flush: vi.fn() }))
vi.mock('@/lib/confirm', () => ({ confirmDialog: mocks.confirm }))
vi.mock('@/lib/pending-record-saves', () => ({ flushRecordSaves: mocks.flush }))
vi.mock('@/components/download-link', () => ({ DownloadLink: () => null }))
vi.mock('next/link', () => ({ default: () => null }))
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: unknown }) => value,
  GeneratedText: ({ id }: { id: string }) => id,
  useGeneratedTranslations: () => (value: string) => value,
  useGeneratedValueTranslations: () => (value: string) => value,
}))
import { RecordHeaderActions } from './record-header-actions'
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  mocks.confirm.mockResolvedValue(true)
  mocks.flush.mockResolvedValue(undefined)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
async function render(lockAction: () => Promise<void | { error: string; details?: string[] }>) {
  await act(async () =>
    root.render(
      <RecordHeaderActions
        id="inspection"
        locked={false}
        canDelete={false}
        canCopy={false}
        canEmail={false}
        pdfHref="/pdf"
        emailHref="/email"
        deleteHref="/delete"
        copyAction={async () => {}}
        unlockAction={async () => {}}
        lockAction={lockAction}
      />,
    ),
  )
}
describe('inspection submit feedback', () => {
  it('keeps the record open with the exact missing item and allows a successful retry', async () => {
    const lock = vi
      .fn()
      .mockResolvedValueOnce({
        error: 'Cannot submit: 1 inspection item incomplete',
        details: ['Other: severity'],
      })
      .mockResolvedValueOnce(undefined)
    await render(lock)
    const form = container.querySelector('form')!
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Other: severity')
    expect(container.querySelector('button')).not.toBeNull()
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(lock).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
  it('keeps unexpected submission failures on the record without claiming completion', async () => {
    await render(vi.fn().mockRejectedValue(new Error('Internal database failure')))
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Your work was not reported as complete',
    )
    expect(container.textContent).not.toContain('Internal database failure')
  })
})

describe('copy save barrier', () => {
  async function renderCopy(copy: (data: FormData) => Promise<void>, photos = false) {
    await act(async () =>
      root.render(
        <RecordHeaderActions
          id="source"
          locked={false}
          canDelete={false}
          canLock={false}
          canEmail={false}
          pdfHref="/pdf"
          emailHref="/email"
          deleteHref="/delete"
          copyAction={copy}
          lockAction={async () => {}}
          unlockAction={async () => {}}
          offerPhotoCopy={photos}
        />,
      ),
    )
  }
  it('waits for all pending edits before asking the server to copy', async () => {
    let finish!: () => void
    mocks.flush.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const copy = vi.fn(async () => {})
    await renderCopy(copy)
    const button = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Copy assessment'),
    )!
    await act(async () => button.click())
    expect(mocks.flush).toHaveBeenCalledOnce()
    expect(copy).not.toHaveBeenCalled()
    await act(async () => finish())
    expect(copy).toHaveBeenCalledOnce()
  })
  it('cancelling the photo/content confirmation leaves the source untouched', async () => {
    mocks.confirm.mockResolvedValue(false)
    const copy = vi.fn(async () => {})
    await renderCopy(copy, true)
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((b) => b.textContent?.includes('Copy assessment'))!
        .click(),
    )
    expect(copy).not.toHaveBeenCalled()
    expect(mocks.flush).not.toHaveBeenCalled()
  })
})
