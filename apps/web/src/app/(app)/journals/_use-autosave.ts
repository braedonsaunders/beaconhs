'use client'

import { useCallback, useEffect, useState } from 'react'
import { LatestAutosaveQueue, type AutosaveSnapshot } from '@/lib/autosave-queue'
import { FLUSH_RECORD_SAVES, forgetRecordSave, trackRecordSave } from '@/lib/pending-record-saves'
import type { EntryPatch } from './_types'

type SaveEntry = (input: {
  id: string
  patch: EntryPatch
}) => Promise<{ ok: boolean; error?: string }>

/** One mounted queue per journal; switching entries must not discard its last edit. */
export function useJournalAutosave(id: string, enabled: boolean, saveEntry: SaveEntry) {
  const [queue] = useState(() => new LatestAutosaveQueue())
  const [key] = useState(() => Symbol('journal-save'))
  const [snapshot, setSnapshot] = useState<AutosaveSnapshot>({ state: 'saved', error: null })

  useEffect(() => queue.subscribe(setSnapshot), [queue])

  const flush = useCallback(() => trackRecordSave(key, queue.flush()), [key, queue])

  useEffect(() => {
    const persist = () => void flush().catch(() => {})
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!queue.hasWork()) return
      event.preventDefault()
      event.returnValue = ''
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') persist()
    }
    window.addEventListener(FLUSH_RECORD_SAVES, persist)
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener(FLUSH_RECORD_SAVES, persist)
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('visibilitychange', onVisibility)
      // Client navigation can unmount the pane before its debounce expires.
      // Keep the write tracked so a subsequent submit still waits for it.
      if (queue.hasWork()) void flush().catch(() => {})
      else forgetRecordSave(key)
    }
  }, [flush, key, queue])

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
