'use client'

// Local-first field edits for one existing record (a Builder record page or
// any native module record page).
//
// Same store, engine, queue, and indicator as the guided fill page; the queued
// work is a set of per-field patches instead of a whole-draft snapshot, sent
// to /api/records/sync where the module's saver applies each one as a
// compare-and-set.
// - Each field edit is written to the device immediately and synced by the
//   engine (coalesced per field, retried with backoff, beaconed on hide).
// - On load, device edits whose base still matches the server are restored;
//   ones the server already holds are dropped; ones whose field changed
//   elsewhere pause editing until the worker chooses a copy. A field the page
//   renders later (a section that opens, a row that appears) is reconciled
//   when it appears.
// - Submit barriers (`flushRecordSaves`) push the queue first and refuse to
//   continue while edits cannot be delivered.

import { useCallback, useEffect, useRef, useState } from 'react'
import { registerRecordFlusher } from '@/lib/pending-record-saves'
import { getDraftSyncEngine, type DraftSyncState } from './engine'
import {
  emptyFieldsWork,
  hasFieldConflicts,
  pendingCount,
  reconcileFieldPatches,
  recordEditsKey,
  type DraftBlock,
  type FieldsWork,
} from './model'
import { useOfflineDraftsContext } from './provider'
import type { RecordSyncModule } from './record-sync-modules'
import { useDraftSyncState } from './use-draft-sync-state'

// A page in another tab (or the background queue) may briefly hold the record
// while it finishes a sync; wait that long before treating it as taken.
const CLAIM_WAIT_MS = 3_000

const OFFLINE_SUBMIT_ERROR = 'You need signal for this step. Your answers are saved on this device.'
const UNSYNCED_SUBMIT_ERROR =
  'Some changes on this device have not synced yet. Try again when the form shows Synced.'

type HeldLock = { release: () => void }

export type OfflineRecordEditsOptions = {
  enabled: boolean
  module: RecordSyncModule
  recordId: string | null
  /** False while the record is locked or read-only: device edits are shown as stranded. */
  editable?: boolean
  /** The value the page shows for a field, or null when the page has not shown it. */
  readServerValue: (fieldId: string) => { value: unknown } | null
  /** Put values into the page (restore / discard). Must not count as edits. */
  onRestore: (values: Record<string, unknown>) => void
  /** Record typed input that is still debouncing (before hiding or submitting). */
  flushInput?: () => void
  /** Called once queued edits have landed and nothing is pending (e.g. refresh the page). */
  onSettled?: () => void
}

export type OfflineRecordEditsHandle = {
  key: string | null
  state: DraftSyncState | null
  restored: { origin: 'resume' } | null
  conflict: boolean
  awaitingChoice: boolean
  /** Device edits that cannot be sent because the record is not editable. */
  stranded: boolean
  recordField: (fieldId: string, value: unknown) => void
  /** The page now shows this server value for a field with no pending edit. */
  noteServerValue: (fieldId: string, value: unknown) => void
  /** A field appeared after the claim: reconcile its device edit, if any. */
  reconcileField: (fieldId: string) => void
  retry: () => void
  dismissRestored: () => void
  discardDeviceCopy: () => void
  takeDeviceCopy: () => void
  takeSavedVersion: () => void
  discardStranded: () => void
}

export function useOfflineRecordEdits(
  options: OfflineRecordEditsOptions,
): OfflineRecordEditsHandle {
  const { enabled, module, recordId } = options
  const editable = options.editable !== false
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
  // Restored fields → the server value they replaced (what Discard puts back).
  const restoredRef = useRef<Record<string, unknown>>({})
  const conflictValuesRef = useRef<Record<string, unknown> | null>(null)

  useEffect(() => {
    if (!enabled || !recordId) return
    let cancelled = false
    let lock: HeldLock | null = null
    const engine = getDraftSyncEngine()
    const recordKey = recordEditsKey(scopeKey ?? 'unscoped', module, recordId)

    // Edits made before the claim finished (the Map itself never changes).
    const earlyEdits = earlyEditsRef.current
    // Unmounted before the claim finished: still claim the record if edits
    // were made meanwhile, so they reach the device and the queue.
    const abandoned = () => cancelled && earlyEdits.size === 0

    void (async () => {
      await engine.ready()
      if (abandoned()) return
      lock = scopeKey ? await engine.acquireLock(recordKey, CLAIM_WAIT_MS) : null
      const stored = lock
        ? (engine.inMemoryRecord(recordKey) ?? (await engine.readStored(recordKey)))
        : null
      if (abandoned()) {
        lock?.release()
        return
      }
      const props = { ...optionsRef.current, editable: optionsRef.current.editable !== false }
      let work: FieldsWork = emptyFieldsWork()
      let blocked: DraftBlock | null = null
      if (stored?.work.kind === 'fields' && pendingCount(stored.work) > 0 && !props.editable) {
        // The record is locked (or no longer editable here): these edits can
        // never apply. Keep them out of the page and offer to discard them.
        work = stored.work
        blocked = 'rejected'
      } else if (!cancelled && stored?.work.kind === 'fields' && pendingCount(stored.work) > 0) {
        const outcome = reconcileFieldPatches(stored.work, props.readServerValue)
        work = outcome.work
        restoredRef.current = Object.fromEntries(
          Object.keys(outcome.restored).map((fieldId) => [
            fieldId,
            props.readServerValue(fieldId)?.value,
          ]),
        )
        if (Object.keys(outcome.restored).length > 0) {
          props.onRestore(outcome.restored)
          setRestored({ origin: 'resume' })
        }
        // Includes conflicts reported before a reload on fields the page has
        // not shown yet: the worker must still choose.
        if (Object.keys(outcome.conflicted).length > 0 || hasFieldConflicts(work)) {
          conflictValuesRef.current = outcome.conflicted
          blocked = 'conflict'
          setAwaitingChoice(true)
        }
      } else if (cancelled && stored?.work.kind === 'fields') {
        work = stored.work
      }
      engine.open(
        {
          key: recordKey,
          scope: scopeKey ?? '',
          tenantId: scope?.tenantId ?? '',
          userId: scope?.userId ?? '',
          target: 'record',
          module,
          recordId,
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
      for (const [fieldId, value] of earlyEdits) {
        engine.recordField(recordKey, fieldId, value, props.readServerValue(fieldId)?.value)
      }
      earlyEdits.clear()
      if (cancelled) {
        // The page already left: hand the edits to the background queue.
        void engine.flush(recordKey).finally(() => {
          engine.release(recordKey)
          lock?.release()
        })
        return
      }
      keyRef.current = recordKey
      setKey(recordKey)
      if (!blocked && pendingCount(work) > 0) void engine.flush(recordKey)
    })()

    return () => {
      cancelled = true
      if (keyRef.current === recordKey) {
        // Leaving within the app: the engine keeps syncing in the background.
        // keyRef stays set so fields unmounting after this can still queue
        // their last edit.
        optionsRef.current.flushInput?.()
        void engine.flush(recordKey)
        engine.release(recordKey)
      }
      // A claim still running keeps its lock until it hands its edits over.
      if (keyRef.current === recordKey || earlyEdits.size === 0) lock?.release()
    }
  }, [enabled, module, recordId, scope, scopeKey])

  // iOS may freeze or discard a hidden page without another event: record
  // typed input on the device and send what is queued as the page hides.
  useEffect(() => {
    if (!enabled) return
    const persistNow = () => {
      optionsRef.current.flushInput?.()
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

  // Submit, lock, sign, and record switches wait for this record's queue.
  useEffect(() => {
    if (!enabled) return
    return registerRecordFlusher(async () => {
      // A record that cannot be edited here has nothing it can send; its
      // stranded edits must not block unrelated steps (e.g. Unlock / Reopen).
      if (optionsRef.current.editable === false) return
      optionsRef.current.flushInput?.()
      const current = keyRef.current
      if (!current) return
      const outcome = await getDraftSyncEngine().flush(current)
      if (outcome.ok) return
      throw new Error(
        outcome.offline ? OFFLINE_SUBMIT_ERROR : (outcome.error ?? UNSYNCED_SUBMIT_ERROR),
      )
    })
  }, [enabled])

  const state = useDraftSyncState(enabled ? key : null)

  // Let the page follow edits once they land (native record pages re-render
  // their server-rendered headers, badges, and derived values).
  const lastSyncedAt = state?.lastSyncedAt ?? null
  const settled = state !== null && state.pending === 0 && !state.syncing
  const seenSyncRef = useRef<number | null>(null)
  useEffect(() => {
    if (lastSyncedAt === null || !settled || seenSyncRef.current === lastSyncedAt) return
    seenSyncRef.current = lastSyncedAt
    optionsRef.current.onSettled?.()
  }, [lastSyncedAt, settled])

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
      optionsRef.current.readServerValue(fieldId)?.value,
    )
  }, [])

  const noteServerValue = useCallback((fieldId: string, value: unknown) => {
    if (keyRef.current) getDraftSyncEngine().noteServerValue(keyRef.current, fieldId, value)
  }, [])

  const reconcileField = useCallback((fieldId: string) => {
    const current = keyRef.current
    if (!current) return // The claim reconciles every field shown by then.
    const server = optionsRef.current.readServerValue(fieldId)
    if (!server) return
    const result = getDraftSyncEngine().reconcileField(current, fieldId, server.value)
    if (!result) return
    if (result.kind === 'restored') {
      optionsRef.current.onRestore({ [fieldId]: result.value })
      restoredRef.current = { ...restoredRef.current, [fieldId]: server.value }
      setRestored({ origin: 'resume' })
    } else {
      conflictValuesRef.current = { ...conflictValuesRef.current, [fieldId]: result.value }
      setAwaitingChoice(true)
    }
  }, [])

  const retry = useCallback(() => {
    if (keyRef.current) getDraftSyncEngine().retry(keyRef.current)
  }, [])

  const dismissRestored = useCallback(() => setRestored(null), [])

  // "Discard" on the restored banner: put back the server values the restored
  // edits replaced. Restored edits are sent straight away (they are newer
  // than the server), so ones already sent are reverted with a new edit.
  const discardDeviceCopy = useCallback(() => {
    const current = keyRef.current
    if (!current) return
    const engine = getDraftSyncEngine()
    const replaced = restoredRef.current
    const fields = Object.keys(replaced)
    const work = engine.getWork(current)
    const neverSent = fields.filter(
      (fieldId) => work?.kind === 'fields' && work.patches[fieldId]?.sent.length === 0,
    )
    engine.dropFields(current, neverSent)
    for (const fieldId of fields) {
      if (neverSent.includes(fieldId)) continue
      engine.recordField(
        current,
        fieldId,
        replaced[fieldId],
        optionsRef.current.readServerValue(fieldId)?.value,
      )
    }
    optionsRef.current.onRestore(replaced)
    restoredRef.current = {}
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
    const engine = getDraftSyncEngine()
    engine.dropFields(current, 'conflicts')
    if (conflictValuesRef.current) {
      // Found on load: the page already shows the saved values.
      conflictValuesRef.current = null
      setAwaitingChoice(false)
      return
    }
    // Found while editing: reload to show the newer saved values. Other
    // unsynced edits stay on the device and are restored after the reload —
    // once the dropped ones are gone from the device store.
    void engine.storeSettled().then(() => window.location.reload())
  }, [])

  // The record can no longer be edited here (locked, or access removed):
  // drop the device edits it can never accept and show the saved values.
  const discardStranded = useCallback(() => {
    const current = keyRef.current
    if (!current) return
    const engine = getDraftSyncEngine()
    const work = engine.getWork(current)
    const fields = work?.kind === 'fields' ? Object.keys(work.patches) : []
    engine.dropFields(current, fields)
    const { readServerValue, onRestore } = optionsRef.current
    const shown = fields.flatMap((fieldId) => {
      const server = readServerValue(fieldId)
      return server ? [[fieldId, server.value] as const] : []
    })
    onRestore(Object.fromEntries(shown))
    restoredRef.current = {}
    conflictValuesRef.current = null
    setRestored(null)
    setAwaitingChoice(false)
  }, [])

  return {
    key,
    state,
    restored,
    conflict: state?.blocked === 'conflict',
    awaitingChoice,
    stranded: !editable && (state?.pending ?? 0) > 0,
    recordField,
    noteServerValue,
    reconcileField,
    retry,
    dismissRestored,
    discardDeviceCopy,
    takeDeviceCopy,
    takeSavedVersion,
    discardStranded,
  }
}
