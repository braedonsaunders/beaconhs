'use client'

// Debounced autosave for the live draft (ports the journals editor pattern:
// pending + timer refs, flush on unmount). High-frequency — saveDraft skips
// revalidate/audit server-side.

import { useCallback, useEffect, useRef, useState } from 'react'
import { saveDraft } from '../_actions'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function useDocumentAutosave(documentId: string) {
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const pending = useRef<{ contentJson: unknown; contentHtml: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(() => {
    const patch = pending.current
    pending.current = null
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (!patch) return
    setSaveState('saving')
    saveDraft({ documentId, contentJson: patch.contentJson, contentHtml: patch.contentHtml })
      .then((r) => setSaveState(r.ok ? 'saved' : 'error'))
      .catch(() => setSaveState('error'))
  }, [documentId])

  const queueSave = useCallback(
    (contentJson: unknown, contentHtml: string, delay = 700) => {
      pending.current = { contentJson, contentHtml }
      setSaveState('saving')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, delay)
    },
    [flush],
  )

  // Flush pending edits on unmount / navigation away.
  useEffect(() => {
    return () => flush()
  }, [flush])

  return { saveState, queueSave, flush }
}
