// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushRecordSaves } from '@/lib/pending-record-saves'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  edit: null as null | ((html: string, text: string) => void),
}))
vi.mock('./_actions', () => ({ createTodayEntry: mocks.create, updateEntry: mocks.update }))
vi.mock('./_editor', () => ({
  JournalEditor: ({ onChange }: { onChange: typeof mocks.edit }) => {
    mocks.edit = onChange
    return null
  },
}))
vi.mock('@/i18n/generated', () => ({ GeneratedValue: ({ value }: { value: unknown }) => value }))
import { TodayComposer } from './_today-composer'

let root: Root
let container: HTMLDivElement
const open = vi.fn()
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.create.mockResolvedValue({ ok: true, id: 'new-entry' })
  mocks.update.mockResolvedValue({ ok: true })
  open.mockResolvedValue(undefined)
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(<TodayComposer aiEnabled={false} onCreated={open} onBrowse={() => {}} />),
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
      patch: { bodyHtml: '<p>All 10 points</p>' },
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
