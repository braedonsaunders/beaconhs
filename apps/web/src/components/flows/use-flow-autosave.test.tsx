// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  emptyAutomationGraph,
  lintAutomationGraph,
  type AutomationGraph,
} from '@beaconhs/forms-core'
import { useFlowAutosave } from './use-flow-autosave'
const trigger: AutomationGraph['nodes'][number] = {
  id: 'trigger',
  position: { x: 0, y: 0 },
  data: { kind: 'trigger', trigger: { trigger: 'on_submit' } },
}
const original: AutomationGraph = {
  ...emptyAutomationGraph(),
  edges: [{ id: 'to-mike', source: 'trigger', target: 'mike', sourceHandle: 'next' }],
  nodes: [
    trigger,
    {
      id: 'mike',
      position: { x: 0, y: 0 },
      data: {
        kind: 'action',
        action: {
          action: 'send_email',
          to: [{ type: 'literal', email: 'mike@example.com' }],
          subject: 'Hazard assessment',
          bodyTemplate: 'Please review',
        },
      },
    },
  ],
}
const removed: AutomationGraph = { ...emptyAutomationGraph(), nodes: [trigger] }
let root: Root
let container: HTMLDivElement
const save = vi.fn<
  (id: string, graph: AutomationGraph) => Promise<{ ok: boolean; error?: string }>
>(async () => ({ ok: true }))
function Harness({
  id,
  graph,
  enabled = true,
}: {
  id: string
  graph: AutomationGraph
  enabled?: boolean
}) {
  const controls = useFlowAutosave({
    initial: [
      { id: 'a', graph: original },
      { id: 'b', graph: removed },
    ],
    flowId: id,
    graph,
    enabled,
    saveFlow: save,
  })
  return (
    <>
      <span>
        {controls.snapshot.state}:{controls.snapshot.error}
      </span>
      <button
        type="button"
        onClick={() => {
          void controls.queue.retry()
        }}
      >
        Retry
      </button>
    </>
  )
}
async function render(id: string, graph: AutomationGraph, enabled = true) {
  await act(async () => root.render(<Harness id={id} graph={graph} enabled={enabled} />))
}
beforeEach(() => {
  vi.useFakeTimers()
  save.mockReset()
  save.mockResolvedValue({ ok: true })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})
describe('flow graph autosave', () => {
  it('persists node deletion across a flow switch without rewriting the newly selected graph', async () => {
    await render('a', original)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(save).not.toHaveBeenCalled()
    await render('a', removed)
    await render('b', removed)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(lintAutomationGraph(removed, new Set())).toEqual([])
    expect(save).toHaveBeenCalledExactlyOnceWith('a', removed)
    expect(container.querySelector('span')!.textContent).toBe('saved:')
  })
  it('keeps the failed deletion queued and warns before refresh until a retry succeeds', async () => {
    save.mockResolvedValueOnce({ ok: false, error: 'Network unavailable' })
    await render('a', original)
    await render('a', removed)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(container.textContent).toContain('error:Network unavailable')
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(save).toHaveBeenCalledTimes(2)
    expect(container.querySelector('span')!.textContent).toBe('saved:')
  })
  it('flushes pending changes on unmount and never saves a read-only graph', async () => {
    await render('a', original)
    await render('a', removed, false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(save).not.toHaveBeenCalled()
    await render('a', removed)
    await act(async () => root.unmount())
    expect(save).toHaveBeenCalledExactlyOnceWith('a', removed)
  })
})
