// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushRecordSaves } from '@/lib/pending-record-saves'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  submit: vi.fn(),
  edit: null as null | ((html: string, text: string) => void),
  pickSupervisor: null as null | ((value: string) => void),
}))
vi.mock('./_actions', () => ({
  createTodayEntry: mocks.create,
  updateEntry: mocks.update,
  submitEntry: mocks.submit,
}))
vi.mock('./_editor', () => ({
  JournalEditor: ({ onChange }: { onChange: typeof mocks.edit }) => {
    mocks.edit = onChange
    return null
  },
}))
vi.mock('@/components/remote-search-select', () => ({
  RemoteSearchSelect: ({ onChange }: { onChange: (value: string) => void }) => {
    mocks.pickSupervisor = onChange
    return null
  },
}))
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: unknown }) => value,
  useGeneratedValueTranslations: () => (value: string) => value,
}))
import { TodayComposer } from './_today-composer'

let root: Root
let container: HTMLDivElement
const open = vi.fn()
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.create.mockResolvedValue({ ok: true, id: 'new-entry' })
  mocks.update.mockResolvedValue({ ok: true })
  mocks.submit.mockResolvedValue({ ok: true })
  open.mockResolvedValue(undefined)
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(<TodayComposer aiEnabled={false} canSubmit onCreated={open} onBrowse={() => {}} />),
  )
})
afterEach(async () => {
  mocks.update.mockResolvedValue({ ok: true })
  await act(async () => {
    await flushRecordSaves()
  })
  await act(async () => root.unmount())
  container.remove()
})

describe('new journal save barrier', () => {
  it('waits for creation and all text typed during it before allowing navigation', async () => {
    let finish!: (value: { ok: boolean; id: string }) => void
    mocks.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await act(async () => mocks.edit!('<p>First 8</p>', 'First 8'))
    await act(async () => mocks.edit!('<p>All 10 points</p>', 'All 10 points'))
    const leaving = flushRecordSaves()
    expect(open).not.toHaveBeenCalled()
    await act(async () => {
      finish({ ok: true, id: 'new-entry' })
      await leaving
    })
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      id: 'new-entry',
      patch: { bodyHtml: '<p>All 10 points</p>', supervisorPersonId: null },
    })
    expect(open).toHaveBeenCalledExactlyOnceWith('new-entry')
  })

  it('retains failed content, blocks refresh, and retries without creating another entry', async () => {
    mocks.update.mockResolvedValueOnce({ ok: false, error: 'Connection unavailable' })
    await act(async () => mocks.edit!('<p>Final points</p>', 'Final points'))
    expect(container.textContent).toContain('Connection unavailable')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    await act(async () => {
      await flushRecordSaves()
    })
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(mocks.update).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenCalledExactlyOnceWith('new-entry')
  })
})

function submitButton() {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === 'Submit',
  )!
}
async function chooseSupervisor(value = 'supervisor') {
  await act(async () => mocks.pickSupervisor!(value))
}
async function clickSubmit() {
  await act(async () => submitButton().click())
}

describe('fresh journal submission', () => {
  it('shows Submit before the first save, but requires some text', () => {
    expect(submitButton()).toBeDefined()
    expect(submitButton().disabled).toBe(true)
  })
  it('saves all text typed during creation before submitting the same entry', async () => {
    await chooseSupervisor()
    let finish!: (value: { ok: true; id: string }) => void
    mocks.create.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await act(async () => mocks.edit!('<p>First line</p>', 'First line'))
    await act(async () => mocks.edit!('<p>Final line</p>', 'Final line'))
    expect(submitButton().disabled).toBe(false)
    await clickSubmit()
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    await act(async () => finish({ ok: true, id: 'new-entry' }))
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      id: 'new-entry',
      patch: { bodyHtml: '<p>Final line</p>', supervisorPersonId: 'supervisor' },
    })
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith('new-entry')
    expect(open).toHaveBeenCalledExactlyOnceWith('new-entry')
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.submit.mock.invocationCallOrder[0]!,
    )
    expect(mocks.submit.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[0]!)
  })
  it('blocks submission on a failed save and retains visible feedback above the text', async () => {
    await chooseSupervisor()
    let finish!: (value: { ok: false; error: string }) => void
    mocks.update.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await act(async () => mocks.edit!('<p>Unsaved words</p>', 'Unsaved words'))
    await clickSubmit()
    await act(async () => finish({ ok: false, error: 'Connection unavailable' }))
    expect(mocks.submit).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')?.parentElement?.className).toContain(
      'shrink-0',
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Connection unavailable',
    )
    await clickSubmit()
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith('new-entry')
    expect(open).toHaveBeenCalledOnce()
  })
  it('keeps a draft when the submit action fails and allows retry without a duplicate', async () => {
    await chooseSupervisor()
    let finish!: (value: { ok: true }) => void
    mocks.update.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    mocks.submit.mockResolvedValueOnce({ ok: false, error: 'Submission unavailable' })
    await act(async () => mocks.edit!('<p>Journal</p>', 'Journal'))
    await clickSubmit()
    await act(async () => finish({ ok: true }))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Submission unavailable',
    )
    expect(open).not.toHaveBeenCalled()
    await clickSubmit()
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(mocks.submit).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenCalledOnce()
  })
  it('does not re-submit if opening the submitted journal fails', async () => {
    await chooseSupervisor()
    let finish!: (value: { ok: true }) => void
    mocks.update.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    open.mockRejectedValueOnce(new Error('Open failed'))
    await act(async () => mocks.edit!('<p>Journal</p>', 'Journal'))
    await clickSubmit()
    await act(async () => finish({ ok: true }))
    expect(container.textContent).toContain('Submitted')
    expect(container.textContent).toContain('Open failed')
    const retry = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Retry opening journal'),
    )!
    await act(async () => retry.click())
    expect(mocks.submit).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledTimes(2)
  })
  it('keeps saving draft text but blocks Submit until a supervisor is selected', async () => {
    await act(async () => mocks.edit!('<p>Draft words</p>', 'Draft words'))
    expect(submitButton().disabled).toBe(true)
    expect(container.textContent).toContain(
      'Choose an active supervisor before submitting your journal.',
    )
    expect(mocks.update).toHaveBeenCalledWith({
      id: 'new-entry',
      patch: { bodyHtml: '<p>Draft words</p>', supervisorPersonId: null },
    })
    await clickSubmit()
    expect(mocks.submit).not.toHaveBeenCalled()
    await chooseSupervisor()
    expect(submitButton().disabled).toBe(false)
  })
  it('saves the latest supervisor selected during a pending save before submission', async () => {
    await chooseSupervisor()
    let finish!: (value: { ok: true }) => void
    mocks.update.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await act(async () => mocks.edit!('<p>Journal</p>', 'Journal'))
    await chooseSupervisor('supervisor-two')
    await clickSubmit()
    await act(async () => finish({ ok: true }))
    expect(mocks.update).toHaveBeenNthCalledWith(2, {
      id: 'new-entry',
      patch: { bodyHtml: '<p>Journal</p>', supervisorPersonId: 'supervisor-two' },
    })
    expect(mocks.submit).toHaveBeenCalledExactlyOnceWith('new-entry')
    expect(mocks.update.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.submit.mock.invocationCallOrder[0]!,
    )
  })
  it('does not offer submission to accounts without the permission', async () => {
    await act(async () =>
      root.render(
        <TodayComposer aiEnabled={false} canSubmit={false} onCreated={open} onBrowse={() => {}} />,
      ),
    )
    expect(submitButton()).toBeUndefined()
  })
})
