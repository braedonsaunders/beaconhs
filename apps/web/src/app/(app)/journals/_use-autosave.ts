'use client'

import { useCallback } from 'react'
import { useRecordAutosaveQueue } from '@/components/use-record-autosave-queue'
import type { EntryPatch } from './_types'

type SaveEntry = (input: {
  id: string
  patch: EntryPatch
}) => Promise<{ ok: boolean; error?: string }>

/** One mounted queue per journal; switching entries must not discard its last edit. */
export function useJournalAutosave(id: string, enabled: boolean, saveEntry: SaveEntry) {
  const { queue, flush, snapshot } = useRecordAutosaveQueue()
  const schedule = useCallback(
    (patch: EntryPatch, delay = 700) => {
      if (!enabled) return
      // Independent fields must not replace each other's pending changes.
      for (const [field, value] of Object.entries(patch)) {
        queue.schedule(field, delay, async () => {
          const result = await saveEntry({ id, patch: { [field]: value } })
          if (!result.ok) throw new Error(result.error ?? 'Could not save your journal.')
        })
      }
    },
    [enabled, id, queue, saveEntry],
  )

  return { schedule, flush, snapshot }
}
