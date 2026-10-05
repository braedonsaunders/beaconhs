'use client'

import { useCallback, useEffect, useState } from 'react'
import { LatestAutosaveQueue, type AutosaveSnapshot } from '@/lib/autosave-queue'
import { FLUSH_RECORD_SAVES, forgetRecordSave, trackRecordSave } from '@/lib/pending-record-saves'

/** Share durable save state and submission barriers across record editors. */
export function useRecordAutosaveQueue() {
  const [queue] = useState(() => new LatestAutosaveQueue())
  const [key] = useState(() => Symbol('record-autosave'))
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

  return { queue, flush, snapshot }
}
