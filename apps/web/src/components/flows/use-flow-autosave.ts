'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AutomationGraph } from '@beaconhs/forms-core'
import { LatestAutosaveQueue, type AutosaveSnapshot } from '../../lib/autosave-queue'

type SaveFlow = (id: string, graph: AutomationGraph) => Promise<{ ok: boolean; error?: string }>

/** Keep each flow's latest graph queued across canvas switches and serialize writes. */
export function useFlowAutosave({
  initial,
  flowId,
  graph,
  enabled,
  saveFlow,
}: {
  initial: { id: string; graph: AutomationGraph }[]
  flowId: string | null
  graph: AutomationGraph
  enabled: boolean
  saveFlow: SaveFlow
}) {
  const [queue] = useState(() => new LatestAutosaveQueue())
  const [snapshot, setSnapshot] = useState<AutosaveSnapshot>({ state: 'saved', error: null })
  const signatures = useRef(new Map(initial.map((flow) => [flow.id, JSON.stringify(flow.graph)])))

  useEffect(() => queue.subscribe(setSnapshot), [queue])
  useEffect(() => {
    if (!enabled || !flowId) return
    const signature = JSON.stringify(graph)
    if (signatures.current.get(flowId) === signature) return
    signatures.current.set(flowId, signature)
    queue.schedule(flowId, 500, async () => {
      const result = await saveFlow(flowId, graph)
      if (!result.ok) throw new Error(result.error ?? 'Could not save the flow. Please retry.')
    })
  }, [enabled, flowId, graph, queue, saveFlow])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!queue.hasWork()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      // Surface changes unmount the canvas. Flush already authorized edits
      // instead of losing the debounce timer and its last graph.
      if (queue.hasWork())
        void queue.flush().catch((error) => console.error('[flow-autosave]', error))
    }
  }, [queue])

  const acknowledgePersisted = useCallback((id: string, persistedGraph: AutomationGraph) => {
    signatures.current.set(id, JSON.stringify(persistedGraph))
  }, [])

  return { queue, snapshot, acknowledgePersisted }
}
