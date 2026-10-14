'use client'

// Local-first draft persistence for one mounted form filler.
//
// - Every change is written to the device (debounced 300 ms) and queued for
//   the server; hiding or leaving the page writes immediately and sends a
//   beacon.
// - On load, a device copy newer than the server draft is restored (with a
//   "Recovered unsynced changes" banner); one that collides with a newer save
//   from elsewhere pauses the form until the worker chooses a copy.
// - The device copy is removed once the server acknowledges it, or when the
//   server reports the entry was submitted.

import { useCallback, useEffect, useRef, useState } from 'react'
import { getDraftSyncEngine, type DraftSyncState, type FlushOutcome } from './engine'
import {
  draftRecordKey,
  pendingCount,
  reconcileDeviceDraft,
  type DraftClientCursor,
  type DraftServerCursor,
  type DraftSnapshot,
  type OfflineDraftRecord,
  type SnapshotWork,
} from './model'
import { useOfflineDraftsContext } from './provider'
import { useDraftSyncState } from './use-draft-sync-state'

const LOCAL_WRITE_DEBOUNCE_MS = 300
// A form in another tab (or the background queue) may briefly hold a draft
// while it finishes a sync; wait that long before treating it as taken.
const CLAIM_WAIT_MS = 3_000
const CANDIDATE_WAIT_MS = 750

type HeldLock = { release: () => void }

type DraftSession = {
  key: string
  responseId: string
  origin: 'new' | 'resume'
  persist: boolean
}

export type OfflineDraftOptions = {
  enabled: boolean
  templateId: string
  complianceObligationId: string | null
  /** Server row being resumed; null on a blank fill page. */
  initialResponseId: string | null
  /** The resumed row's draft ordering cursor (ignored for a blank page). */
  serverCursor: DraftServerCursor
  /** What the server sent for the form, used when the worker discards a device copy. */
  serverSnapshot: DraftSnapshot
  /** Replace the form's answers (restore / discard). Must not count as an edit. */
  onRestore: (snapshot: DraftSnapshot) => void
}

export type OfflineDraftHandle = {
  state: DraftSyncState | null
  /** A device copy was loaded into the form. */
  restored: { origin: 'new' | 'resume' } | null
  /** Server rejected this device's copy as out of date; the worker must choose. */
  conflict: boolean
  /** The form is paused until the worker resolves a conflict found on load. */
  awaitingChoice: boolean
  update: (snapshot: DraftSnapshot) => void
  flush: () => Promise<FlushOutcome>
  retry: () => void
  dismissRestored: () => void
  discardDeviceCopy: () => void
  takeDeviceCopy: () => void
  takeSavedVersion: () => void
  /** The response id once the server row exists (null for an unsynced new entry). */
  getServerResponseId: () => string | null
  setSubmitting: (submitting: boolean) => void
}

function freshCursor(baseRevision: number, serverCreated: boolean): DraftClientCursor {
  return {
    sessionId: crypto.randomUUID(),
    sequence: 0,
    ackedSequence: 0,
    baseRevision,
    serverCreated,
  }
}

/** A stored record narrowed to an unsynced whole-draft snapshot. */
function snapshotRecord(
  record: OfflineDraftRecord | null,
): (OfflineDraftRecord & { work: SnapshotWork }) | null {
  if (!record || record.work.kind !== 'snapshot' || pendingCount(record.work) === 0) return null
  return record as OfflineDraftRecord & { work: SnapshotWork }
}

export function useOfflineDraft(options: OfflineDraftOptions): OfflineDraftHandle {
  const { enabled, templateId, complianceObligationId, initialResponseId } = options
  const context = useOfflineDraftsContext()
  const scopeKey = context?.scopeKey ?? null
  const scope = context?.scope ?? null

  const [session, setSession] = useState<DraftSession | null>(null)
  const [restored, setRestored] = useState<{ origin: 'new' | 'resume' } | null>(null)
  const [awaitingChoice, setAwaitingChoice] = useState(false)

  // Latest props for async/event code without re-running the claim effect.
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  const sessionRef = useRef<DraftSession | null>(null)
  const lockRef = useRef<HeldLock | null>(null)
  const latestRef = useRef<DraftSnapshot | null>(null)
  const dirtyRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const awaitingChoiceRef = useRef(false)
  const abandonedRef = useRef(false)
  const submittingRef = useRef(false)
  // Device snapshot held back while a load-time conflict waits for a choice.
  const conflictSnapshotRef = useRef<DraftSnapshot | null>(null)
  // Acked sequence when a device copy was restored: tells discard whether the
  // restored copy already reached the server.
  const restoredAckRef = useRef<number | null>(null)

  const writeLatest = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    const current = sessionRef.current
    const snapshot = latestRef.current
    if (!current || !snapshot || !dirtyRef.current || abandonedRef.current) return
    dirtyRef.current = false
    getDraftSyncEngine().recordSnapshot(current.key, snapshot)
  }, [])

  const openSession = useCallback(
    (
      next: DraftSession,
      cursor: DraftClientCursor | null,
      record: (OfflineDraftRecord & { work: SnapshotWork }) | null,
      conflictRevision?: number,
    ) => {
      const engine = getDraftSyncEngine()
      if (record) {
        engine.adoptRecord(record, {
          persist: next.persist,
          owned: true,
          ...(conflictRevision === undefined
            ? {}
            : { blocked: 'conflict', work: { ...record.work, conflictRevision } }),
        })
      } else {
        engine.open(
          {
            key: next.key,
            scope: scopeKey ?? '',
            tenantId: scope?.tenantId ?? '',
            userId: scope?.userId ?? '',
            templateId,
            responseId: next.responseId,
            complianceObligationId,
            origin: next.origin,
          },
          {
            kind: 'snapshot',
            cursor: cursor ?? freshCursor(0, false),
            snapshot: null,
            conflictRevision: null,
          },
          { persist: next.persist, owned: true },
        )
      }
      sessionRef.current = next
      setSession(next)
    },
    [complianceObligationId, scope, scopeKey, templateId],
  )

  // Claim the draft: find this form's device copy (if any), reconcile it with
  // the server's cursor, and register the draft with the sync engine.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const engine = getDraftSyncEngine()
    const keyFor = (responseId: string) =>
      draftRecordKey(scopeKey ?? 'unscoped', 'snapshot', responseId)

    void (async () => {
      await engine.ready()
      if (cancelled) return
      const props = optionsRef.current
      let lock: HeldLock | null = null
      let record: (OfflineDraftRecord & { work: SnapshotWork }) | null = null
      let responseId = initialResponseId
      const origin: DraftSession['origin'] = initialResponseId ? 'resume' : 'new'

      if (scopeKey) {
        if (initialResponseId) {
          const key = keyFor(initialResponseId)
          lock = await engine.acquireLock(key, CLAIM_WAIT_MS)
          if (lock) {
            record = snapshotRecord(engine.inMemoryRecord(key) ?? (await engine.readStored(key)))
          }
        } else {
          // A blank fill page picks up the newest unsynced entry this user
          // started for the same app (and compliance task) on this device.
          const candidates = (await engine.listStored(scopeKey))
            .filter(
              (r) =>
                r.origin === 'new' &&
                r.templateId === templateId &&
                r.complianceObligationId === complianceObligationId &&
                r.work.kind === 'snapshot' &&
                pendingCount(r.work) > 0,
            )
            .sort((a, b) => b.updatedAt - a.updatedAt)
          for (const candidate of candidates) {
            const held = await engine.acquireLock(candidate.key, CANDIDATE_WAIT_MS)
            if (!held) continue
            const fresh = snapshotRecord(
              engine.inMemoryRecord(candidate.key) ?? (await engine.readStored(candidate.key)),
            )
            if (fresh) {
              lock = held
              record = fresh
              responseId = fresh.responseId
              break
            }
            held.release()
          }
          if (!responseId) {
            responseId = crypto.randomUUID()
            lock = await engine.acquireLock(keyFor(responseId), 0)
          }
        }
      }
      if (cancelled) {
        lock?.release()
        return
      }
      const id = responseId ?? crypto.randomUUID()
      lockRef.current = lock
      const next: DraftSession = {
        key: keyFor(id),
        responseId: id,
        origin,
        // Another tab holds this draft: sync from memory only so the two tabs
        // never fight over one device copy.
        persist: scopeKey !== null && lock !== null,
      }
      const serverCursor = initialResponseId ? props.serverCursor : null
      const fresh = freshCursor(serverCursor?.revision ?? 0, initialResponseId !== null)

      if (record) {
        const decision = reconcileDeviceDraft(record.work.cursor, serverCursor)
        const deviceSnapshot = record.work.snapshot
        if (decision.kind === 'restore' && deviceSnapshot) {
          openSession(next, null, record)
          restoredAckRef.current = record.work.cursor.ackedSequence
          dirtyRef.current = false
          latestRef.current = deviceSnapshot
          props.onRestore(deviceSnapshot)
          setRestored({ origin: record.origin })
          void engine.flush(next.key)
        } else if (decision.kind === 'conflict') {
          openSession(next, null, record, decision.serverRevision)
          conflictSnapshotRef.current = deviceSnapshot
          awaitingChoiceRef.current = true
          setAwaitingChoice(true)
        } else {
          engine.deleteStored(next.key)
          openSession(next, fresh, null)
        }
      } else {
        openSession(next, fresh, null)
      }
      // Edits typed before the claim finished (rare) are written now unless a
      // device copy replaced the form.
      writeLatest()
    })()

    return () => {
      cancelled = true
      const current = sessionRef.current
      if (current) {
        if (!submittingRef.current) {
          writeLatest()
          // Leaving within the app: the engine keeps syncing in the background.
          void engine.flush(current.key)
        }
        engine.release(current.key)
      }
      sessionRef.current = null
      lockRef.current?.release()
      lockRef.current = null
    }
  }, [
    complianceObligationId,
    enabled,
    initialResponseId,
    openSession,
    scopeKey,
    templateId,
    writeLatest,
  ])

  // Write immediately when the page is hidden or unloaded; iOS may freeze or
  // discard the tab without any further event.
  useEffect(() => {
    if (!enabled) return
    const persistNow = () => {
      const current = sessionRef.current
      if (!current || submittingRef.current) return
      writeLatest()
      getDraftSyncEngine().beacon(current.key)
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
  }, [enabled, writeLatest])

  const state = useDraftSyncState(enabled ? (session?.key ?? null) : null)

  const update = useCallback(
    (snapshot: DraftSnapshot) => {
      if (abandonedRef.current || awaitingChoiceRef.current) return
      latestRef.current = snapshot
      dirtyRef.current = true
      if (!sessionRef.current) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(writeLatest, LOCAL_WRITE_DEBOUNCE_MS)
    },
    [writeLatest],
  )

  const flush = useCallback(async (): Promise<FlushOutcome> => {
    writeLatest()
    const current = sessionRef.current
    if (!current)
      return dirtyRef.current ? { ok: false, offline: false, error: null } : { ok: true }
    return getDraftSyncEngine().flush(current.key)
  }, [writeLatest])

  const retry = useCallback(() => {
    const current = sessionRef.current
    if (current) getDraftSyncEngine().retry(current.key)
  }, [])

  const dismissRestored = useCallback(() => setRestored(null), [])

  // "Discard" on the restored banner: go back to what the server had.
  const discardDeviceCopy = useCallback(() => {
    const current = sessionRef.current
    if (!current) return
    const engine = getDraftSyncEngine()
    const props = optionsRef.current
    if (debounceRef.current) clearTimeout(debounceRef.current)
    dirtyRef.current = false
    latestRef.current = props.serverSnapshot
    props.onRestore(props.serverSnapshot)
    setRestored(null)

    if (current.origin === 'new') {
      // Start over on a brand-new entry. Anything that already synced stays
      // on the server as its own in-progress entry.
      engine.discardSnapshot(current.key, freshCursor(0, false))
      engine.release(current.key)
      sessionRef.current = null
      lockRef.current?.release()
      lockRef.current = null
      const responseId = crypto.randomUUID()
      const nextKey = draftRecordKey(scopeKey ?? 'unscoped', 'snapshot', responseId)
      void engine.acquireLock(nextKey, 0).then((lock) => {
        lockRef.current = lock
        openSession(
          { key: nextKey, responseId, origin: 'new', persist: scopeKey !== null && lock !== null },
          freshCursor(0, false),
          null,
        )
        // Edits made while the new entry was being claimed.
        writeLatest()
      })
      return
    }

    const work = engine.getWork(current.key)
    if (work?.kind === 'snapshot' && work.cursor.ackedSequence === restoredAckRef.current) {
      // The restored copy never reached the server: just forget it.
      engine.discardSnapshot(current.key, freshCursor(props.serverCursor.revision, true))
    } else {
      // It already synced: write the server's previous version back.
      engine.recordSnapshot(current.key, props.serverSnapshot)
    }
  }, [openSession, scopeKey, writeLatest])

  // Conflict → keep this device's copy and overwrite the newer save.
  const takeDeviceCopy = useCallback(() => {
    const current = sessionRef.current
    if (!current) return
    const engine = getDraftSyncEngine()
    const held = conflictSnapshotRef.current
    if (held) {
      latestRef.current = held
      optionsRef.current.onRestore(held)
      conflictSnapshotRef.current = null
    }
    awaitingChoiceRef.current = false
    setAwaitingChoice(false)
    // Rebases onto the revision the server reported for the conflict.
    engine.resolveConflict(current.key, null)
  }, [])

  // Conflict → drop this device's copy and use the newer saved version.
  const takeSavedVersion = useCallback(() => {
    const current = sessionRef.current
    if (!current) return
    const engine = getDraftSyncEngine()
    const props = optionsRef.current
    if (awaitingChoiceRef.current) {
      // Found on load: the form already shows the saved version.
      conflictSnapshotRef.current = null
      awaitingChoiceRef.current = false
      setAwaitingChoice(false)
      engine.discardSnapshot(current.key, freshCursor(props.serverCursor.revision, true))
      return
    }
    // Found while editing: the saved version is newer than this page.
    abandonedRef.current = true
    engine.discardSnapshot(current.key, freshCursor(0, true))
    if (props.initialResponseId) window.location.reload()
    else window.location.assign(`/apps/responses/${current.responseId}`)
  }, [])

  const getServerResponseId = useCallback(() => {
    const current = sessionRef.current
    if (!current) return optionsRef.current.initialResponseId
    const work = getDraftSyncEngine().getWork(current.key)
    return work?.kind === 'snapshot' && work.cursor.serverCreated ? current.responseId : null
  }, [])

  const setSubmitting = useCallback((submitting: boolean) => {
    submittingRef.current = submitting
  }, [])

  return {
    state,
    restored,
    conflict: state?.blocked === 'conflict',
    awaitingChoice,
    update,
    flush,
    retry,
    dismissRestored,
    discardDeviceCopy,
    takeDeviceCopy,
    takeSavedVersion,
    getServerResponseId,
    setSubmitting,
  }
}
