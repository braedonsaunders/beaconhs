'use client'

// Local-first field edits for the record page (inline LiveField autosave).
//
// Same store, engine, queue, and indicator as the guided fill page; the queued
// work is a set of per-field patches instead of a whole-draft snapshot.
// - Each field edit is written to the device immediately and synced by the
//   engine (coalesced per field, retried with backoff, beaconed on hide).
// - On load, device edits whose base still matches the server are restored;
//   ones the server already holds are dropped; ones whose field changed
//   elsewhere pause the form until the worker chooses a copy.

import { useCallback, useEffect, useRef, useState } from 'react'
import { getDraftSyncEngine, type DraftSyncState } from './engine'
import {
  draftRecordKey,
  emptyFieldsWork,
  pendingCount,
  reconcileFieldPatches,
  type DraftBlock,
  type FieldsWork,
} from './model'
import { useOfflineDraftsContext } from './provider'
import { useDraftSyncState } from './use-draft-sync-state'

// A form in another tab (or the background queue) may briefly hold the record
// while it finishes a sync; wait that long before treating it as taken.
const CLAIM_WAIT_MS = 3_000

type HeldLock = { release: () => void }

export type OfflineRecordEditsOptions = {
  enabled: boolean
  templateId: string
  responseId: string | null
  /** Field values as loaded from the server (top-level fields + section arrays). */
  serverValues: Record<string, unknown>
  /** Put field values into the form (restore / discard). Must not count as an edit. */
  onRestore: (values: Record<string, unknown>) => void
}

export type OfflineRecordEditsHandle = {
  state: DraftSyncState | null
  restored: { origin: 'resume' } | null
  conflict: boolean
  awaitingChoice: boolean
  recordField: (fieldId: string, value: unknown) => void
  retry: () => void
  dismissRestored: () => void
  discardDeviceCopy: () => void
  takeDeviceCopy: () => void
  takeSavedVersion: () => void
}

export function useOfflineRecordEdits(
  options: OfflineRecordEditsOptions,
): OfflineRecordEditsHandle {
  const { enabled, templateId, responseId } = options
  const context = useOfflineDraftsContext()
  const scopeKey = context?.scopeKey ?? null
  const scope = context?.scope ?? null

  const [key, setKey] = useState<string | null>(null)
  const [restored, setRestored] = useState<{ origin: 'resume' } | null>(null)
  const [awaitingChoice, setAwaitingChoice] = useState(false)

  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })
  const keyRef = useRef<string | null>(null)
  // Edits made before the claim finished, coalesced per field.
  const earlyEditsRef = useRef(new Map<string, unknown>())
  const restoredFieldsRef = useRef<string[]>([])
  const conflictValuesRef = useRef<Record<string, unknown> | null>(null)

  useEffect(() => {
    if (!enabled || !responseId) return
    let cancelled = false
    let lock: HeldLock | null = null
    const engine = getDraftSyncEngine()
    const recordKey = draftRecordKey(scopeKey ?? 'unscoped', 'fields', responseId)

    void (async () => {
      await engine.ready()
      if (cancelled) return
      lock = scopeKey ? await engine.acquireLock(recordKey, CLAIM_WAIT_MS) : null
      const stored = lock
        ? (engine.inMemoryRecord(recordKey) ?? (await engine.readStored(recordKey)))
        : null
      if (cancelled) {
        lock?.release()
        return
      }
      const props = optionsRef.current
      let work: FieldsWork = emptyFieldsWork()
      let blocked: DraftBlock | null = null
      if (stored?.work.kind === 'fields' && pendingCount(stored.work) > 0) {
        const outcome = reconcileFieldPatches(stored.work, props.serverValues)
        work = outcome.work
        restoredFieldsRef.current = Object.keys(outcome.restored)
        if (restoredFieldsRef.current.length > 0) {
          props.onRestore(outcome.restored)
          setRestored({ origin: 'resume' })
        }
        if (Object.keys(outcome.conflicted).length > 0) {
          conflictValuesRef.current = outcome.conflicted
          blocked = 'conflict'
          setAwaitingChoice(true)
        }
      }
      engine.open(
        {
          key: recordKey,
          scope: scopeKey ?? '',
          tenantId: scope?.tenantId ?? '',
          userId: scope?.userId ?? '',
          templateId,
          responseId,
          complianceObligationId: null,
          origin: 'resume',
        },
        work,
        {
          // Another tab holds this record: sync from memory only.
          persist: scopeKey !== null && lock !== null,
          owned: true,
          blocked,
          ...(stored ? { from: stored } : {}),
        },
      )
      keyRef.current = recordKey
      setKey(recordKey)
      for (const [fieldId, value] of earlyEditsRef.current) {
        engine.recordField(recordKey, fieldId, value, props.serverValues[fieldId])
      }
      earlyEditsRef.current.clear()
      if (!blocked && pendingCount(work) > 0) void engine.flush(recordKey)
    })()

    return () => {
      cancelled = true
      if (keyRef.current === recordKey) {
        // Leaving within the app: the engine keeps syncing in the background.
        // keyRef stays set so field rows unmounting after this can still
        // queue their last edit.
        void engine.flush(recordKey)
        engine.release(recordKey)
      }
      lock?.release()
    }
  }, [enabled, responseId, scope, scopeKey, templateId])

  // Deliver what is queued when the page is hidden or unloaded. Field rows
  // write their own pending values to the device on the same events first.
  useEffect(() => {
    if (!enabled) return
    const persistNow = () => {
      if (keyRef.current) getDraftSyncEngine().beacon(keyRef.current)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') persistNow()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', persistNow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', persistNow)
    }
  }, [enabled])

  const state = useDraftSyncState(enabled ? key : null)

  const recordField = useCallback((fieldId: string, value: unknown) => {
    const current = keyRef.current
    if (!current) {
      earlyEditsRef.current.set(fieldId, value)
      return
    }
    getDraftSyncEngine().recordField(
      current,
      fieldId,
      value,
      optionsRef.current.serverValues[fieldId],
    )
  }, [])

  const retry = useCallback(() => {
    if (keyRef.current) getDraftSyncEngine().retry(keyRef.current)
  }, [])

  const dismissRestored = useCallback(() => setRestored(null), [])

  // "Discard" on the restored banner: put the server's values back.
  const discardDeviceCopy = useCallback(() => {
    const current = keyRef.current
    if (!current) return
    const engine = getDraftSyncEngine()
    const { serverValues, onRestore } = optionsRef.current
    const fields = restoredFieldsRef.current
    const work = engine.getWork(current)
    const pendingFields = work?.kind === 'fields' ? Object.keys(work.patches) : []
    const unsent = fields.filter((fieldId) => pendingFields.includes(fieldId))
    engine.dropFields(current, unsent)
    // Restored edits that already synced are reverted with a new edit.
    for (const fieldId of fields) {
      if (!unsent.includes(fieldId)) {
        engine.recordField(current, fieldId, serverValues[fieldId], serverValues[fieldId])
      }
    }
    onRestore(Object.fromEntries(fields.map((fieldId) => [fieldId, serverValues[fieldId]])))
    restoredFieldsRef.current = []
    setRestored(null)
  }, [])

  // Conflict → keep this device's values and overwrite the newer save.
  const takeDeviceCopy = useCallback(() => {
    const current = keyRef.current
    if (!current) return
    if (conflictValuesRef.current) {
      optionsRef.current.onRestore(conflictValuesRef.current)
      conflictValuesRef.current = null
    }
    setAwaitingChoice(false)
    getDraftSyncEngine().resolveConflict(current, null)
  }, [])

  // Conflict → drop this device's conflicting values and use the saved ones.
  const takeSavedVersion = useCallback(() => {
    const current = keyRef.current
    if (!current) return
    getDraftSyncEngine().dropFields(current, 'conflicts')
    if (conflictValuesRef.current) {
      // Found on load: the form already shows the saved values.
      conflictValuesRef.current = null
      setAwaitingChoice(false)
      return
    }
    // Found while editing: reload to show the newer saved values. Other
    // unsynced edits stay on the device and are restored after the reload.
    window.location.reload()
  }, [])

  return {
    state,
    restored,
    conflict: state?.blocked === 'conflict',
    awaitingChoice,
    recordField,
    retry,
    dismissRestored,
    discardDeviceCopy,
    takeDeviceCopy,
    takeSavedVersion,
  }
}
