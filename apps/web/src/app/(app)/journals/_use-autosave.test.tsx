// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushRecordSaves } from '@/lib/pending-record-saves'
import { useJournalAutosave } from './_use-autosave'
import type { EntryPatch } from './_types'

const save =
  vi.fn<(input: { id: string; patch: EntryPatch }) => Promise<{ ok: boolean; error?: string }>>()
let controls: ReturnType<typeof useJournalAutosave>
let root: Root
let container: HTMLDivElement
function Harness({ id = 'journal-a', editable = true }) {
  const autosave = useJournalAutosave(id, editable, save)
  useEffect(() => {
    controls = autosave
  }, [autosave])
  return (
    <span>
      {autosave.snapshot.state}:{autosave.snapshot.error}
    </span>
  )
}

beforeEach(async () => {
  vi.useFakeTimers()
  save.mockReset().mockResolvedValue({ ok: true })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<Harness />))
})
afterEach(async () => {
  save.mockResolvedValue({ ok: true })
  await act(async () => {
    await controls.flush()
  })
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('journal autosave', () => {
  it('does not save an opened entry, then persists the first edit and final list points', async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(save).not.toHaveBeenCalled()
    const html = '<ol><li>Point 9</li><li>Point 10</li></ol>'
    await act(async () => controls.schedule({ bodyHtml: html }))
    expect(container.textContent).toBe('dirty:')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(save).toHaveBeenCalledExactlyOnceWith({ id: 'journal-a', patch: { bodyHtml: html } })
    expect(container.textContent).toBe('saved:')
  })

  it('serializes edits arriving during a save without dropping other fields', async () => {
    let finish!: (value: { ok: boolean }) => void
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await act(async () => {
      controls.schedule({ bodyHtml: '<p>First 8</p>' })
      await vi.advanceTimersByTimeAsync(700)
      controls.schedule({ bodyHtml: '<p>All 10</p>', entryDate: '2026-10-05' })
      controls.schedule({ tags: ['Work'] }, 0)
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(save).toHaveBeenCalledTimes(1)
    await act(async () => {
      finish({ ok: true })
      await controls.flush()
    })
    expect(save.mock.calls.map(([input]) => input.patch)).toEqual([
      { bodyHtml: '<p>First 8</p>' },
      { bodyHtml: '<p>All 10</p>' },
      { entryDate: '2026-10-05' },
      { tags: ['Work'] },
    ])
    expect(container.textContent).toBe('saved:')
  })

  it('flushes before navigation or submission and retains network failures for retry', async () => {
    save.mockRejectedValueOnce(new Error('Connection lost'))
    await act(async () => {
      controls.schedule({ bodyHtml: '<p>Point 10</p>' })
      await expect(flushRecordSaves()).rejects.toThrow('Connection lost')
    })
    expect(container.textContent).toBe('error:Connection lost')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    await act(async () => {
      await flushRecordSaves()
    })
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]?.[0].patch).toEqual({ bodyHtml: '<p>Point 10</p>' })
    expect(container.textContent).toBe('saved:')
  })

  it('flushes the old entry on unmount without writing it to the newly selected entry', async () => {
    await act(async () => controls.schedule({ bodyHtml: '<p>Last point</p>' }))
    await act(async () => root.render(<Harness key="b" id="journal-b" />))
    expect(save).toHaveBeenCalledExactlyOnceWith({
      id: 'journal-a',
      patch: { bodyHtml: '<p>Last point</p>' },
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('never queues changes for a read-only journal', async () => {
    await act(async () => root.render(<Harness editable={false} />))
    await act(async () => {
      controls.schedule({ bodyHtml: '<p>Forbidden</p>' })
      await controls.flush()
    })
    expect(save).not.toHaveBeenCalled()
  })
})
