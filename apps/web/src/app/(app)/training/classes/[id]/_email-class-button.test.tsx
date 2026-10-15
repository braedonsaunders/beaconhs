// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  flush: vi.fn(),
  email: vi.fn(),
  toastError: vi.fn(),
}))
vi.mock('../_actions', () => ({ emailClass: mocks.email }))
vi.mock('@/lib/confirm', () => ({ confirmDialog: mocks.confirm }))
vi.mock('@/lib/pending-record-saves', () => ({ flushRecordSaves: mocks.flush }))
vi.mock('@/lib/toast', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }))
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: unknown }) => value,
  useGeneratedValueTranslations: () => (value: string) => value,
  useGeneratedTranslations: () => (id: string) => id,
}))
import { EmailClassButton } from './_email-class-button'
let root: Root
let container: HTMLDivElement
function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online })
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  setOnline(true)
  mocks.confirm.mockResolvedValue(true)
  mocks.flush.mockResolvedValue(undefined)
  mocks.email.mockResolvedValue({})
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<EmailClassButton id="class" />))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
async function click() {
  await act(async () => container.querySelector('button')!.click())
}
describe('Email class', () => {
  it('requires explicit confirmation and waits for the latest saved details', async () => {
    let resolve!: () => void
    mocks.flush.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done
      }),
    )
    await click()
    expect(mocks.confirm).toHaveBeenCalled()
    expect(mocks.flush).toHaveBeenCalledTimes(1)
    expect(mocks.email).not.toHaveBeenCalled()
    await act(async () => {
      resolve()
    })
    expect(mocks.email).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Class email queued.')
  })
  it('does not send or claim success when queued class edits could not save', async () => {
    mocks.flush.mockRejectedValue(new Error('Class end time must be after its start time.'))
    await click()
    expect(mocks.email).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('Class end time must be after its start time.')
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
  it('needs signal: nothing is flushed or sent offline', async () => {
    setOnline(false)
    await click()
    expect(mocks.flush).not.toHaveBeenCalled()
    expect(mocks.email).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
  it('shows the roster validation error without a success message', async () => {
    mocks.email.mockResolvedValue({
      error: 'Add employees to the roster before emailing the class.',
    })
    await click()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Add employees')
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
  it('sends nothing if the manager cancels confirmation', async () => {
    mocks.confirm.mockResolvedValue(false)
    await click()
    expect(mocks.flush).not.toHaveBeenCalled()
    expect(mocks.email).not.toHaveBeenCalled()
  })
})
