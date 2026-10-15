'use client'

// Local-first editing for a native module's record page.
//
// Wrap the record page in <OfflineRecordProvider module recordId editable>.
// Every editor on it — the shared live fields, custom fields, criterion
// cards, hazard rows, journal bodies — binds to the provider by field id
// (`useRecordField`) instead of calling a Server Action:
// - an edit is written to the device (debounced ~300 ms; immediately on blur,
//   when the page hides, and on unmount) and queued for /api/records/sync;
// - unsynced values are restored on reload when the server still holds what
//   they were based on, with the same recovery and conflict banner as Builder
//   records (<RecordSyncBanner>);
// - one sync indicator per page (<RecordSyncStatus>) says whether the work is
//   on the server, saved on this device, or waiting for a connection.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { DraftRecoveryBanner, DraftSyncIndicator } from '@/components/draft-sync-status'
import { getDraftSyncEngine } from './engine'
import { jsonEqual } from './model'
import type { RecordSyncModule } from './record-sync-modules'
import { useOfflineRecordEdits, type OfflineRecordEditsHandle } from './use-offline-record-edits'

/** Delay between typing and writing the field to the device. */
export const DEVICE_WRITE_DEBOUNCE_MS = 300
const SAVED_FLASH_MS = 2_000
// Let a burst of acknowledgements settle before re-rendering the server page.
const REFRESH_DELAY_MS = 400
const REFRESH_PROBE_TIMEOUT_MS = 2_500

/**
 * Whether the server is reachable right now. A failed `router.refresh()`
 * makes Next.js fall back to a full browser navigation — in a dead zone that
 * replaces the record page with the browser's offline page — so the page only
 * re-renders after a cheap request to the origin succeeds.
 */
async function serverReachable(): Promise<boolean> {
  if (!navigator.onLine) return false
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REFRESH_PROBE_TIMEOUT_MS)
  try {
    const response = await fetch('/manifest.webmanifest', {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

type FieldBinding = {
  /** The value the page currently shows from the server. */
  server: () => unknown
  /** Show a restored or discarded value (not an edit). */
  restore: (value: unknown) => void
  /** Record typed input that is still debouncing. */
  flushInput: () => void
}

// Two contexts: fields bind through a stable value (so a sync-state change
// does not re-render every field on the page); the status and banner read
// the record's live handle.
type OfflineRecordFieldsContextValue = {
  key: string | null
  /** Editing is paused: the record is read-only or a conflict awaits a choice. */
  paused: boolean
  bind: (fieldId: string, binding: FieldBinding) => () => void
  recordField: (fieldId: string, value: unknown) => void
  noteServerValue: (fieldId: string, value: unknown) => void
  retry: () => void
}

const OfflineRecordFieldsContext = createContext<OfflineRecordFieldsContextValue | null>(null)
const OfflineRecordStatusContext = createContext<OfflineRecordEditsHandle | null>(null)

export function OfflineRecordProvider({
  module,
  recordId,
  editable = true,
  refreshOnSync = true,
  children,
}: {
  module: RecordSyncModule
  recordId: string
  /** False while the record is locked or the worker cannot edit it. */
  editable?: boolean
  /**
   * Re-render the server page once edits land, so server-rendered headers,
   * badges, and derived values follow them. Off for editors that keep the
   * record in client state (e.g. the journal workspace).
   */
  refreshOnSync?: boolean
  children: ReactNode
}) {
  const bindingsRef = useRef(new Map<string, Set<FieldBinding>>())

  const readServerValue = useCallback((fieldId: string) => {
    const first = bindingsRef.current.get(fieldId)?.values().next().value
    return first ? { value: first.server() } : null
  }, [])
  const onRestore = useCallback((values: Record<string, unknown>) => {
    for (const [fieldId, value] of Object.entries(values)) {
      for (const binding of bindingsRef.current.get(fieldId) ?? []) binding.restore(value)
    }
  }, [])
  const flushInput = useCallback(() => {
    for (const set of bindingsRef.current.values()) for (const binding of set) binding.flushInput()
  }, [])

  const router = useRouter()
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Set while a refresh waits for the page to be visible and online again.
  const refreshDueRef = useRef(false)
  const refreshIfReachable = useCallback(async () => {
    if (document.visibilityState !== 'visible' || !(await serverReachable())) {
      refreshDueRef.current = true
      return
    }
    refreshDueRef.current = false
    router.refresh()
  }, [router])
  useEffect(() => {
    const retry = () => {
      if (refreshDueRef.current && document.visibilityState === 'visible') {
        void refreshIfReachable()
      }
    }
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', retry)
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', retry)
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    }
  }, [refreshIfReachable])
  const onSettled = useCallback(() => {
    if (!refreshOnSync) return
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(() => void refreshIfReachable(), REFRESH_DELAY_MS)
  }, [refreshIfReachable, refreshOnSync])

  const handle = useOfflineRecordEdits({
    enabled: true,
    module,
    recordId,
    editable,
    readServerValue,
    onRestore,
    flushInput,
    onSettled,
  })
  const { key, reconcileField, recordField, noteServerValue, retry } = handle

  const bind = useCallback(
    (fieldId: string, binding: FieldBinding) => {
      let set = bindingsRef.current.get(fieldId)
      if (!set) {
        set = new Set()
        bindingsRef.current.set(fieldId, set)
      }
      set.add(binding)
      reconcileField(fieldId)
      return () => {
        set.delete(binding)
        if (set.size === 0) bindingsRef.current.delete(fieldId)
      }
    },
    [reconcileField],
  )

  // A record the server closed (deleted, revoked, completed) takes no edits.
  const paused = !editable || handle.awaitingChoice || handle.state?.closed === true
  const fields = useMemo(
    () => ({ key, paused, bind, recordField, noteServerValue, retry }),
    [bind, key, noteServerValue, paused, recordField, retry],
  )
  return (
    <OfflineRecordFieldsContext.Provider value={fields}>
      <OfflineRecordStatusContext.Provider value={handle}>
        {children}
      </OfflineRecordStatusContext.Provider>
    </OfflineRecordFieldsContext.Provider>
  )
}

const MISSING_PROVIDER = 'Record editors must be rendered inside <OfflineRecordProvider>.'

function useOfflineRecordFields(): OfflineRecordFieldsContextValue {
  const context = useContext(OfflineRecordFieldsContext)
  if (!context) throw new Error(MISSING_PROVIDER)
  return context
}

function useOfflineRecordStatus(): OfflineRecordEditsHandle {
  const handle = useContext(OfflineRecordStatusContext)
  if (!handle) throw new Error(MISSING_PROVIDER)
  return handle
}

/** The record's sync indicator (render once per record page, e.g. in the header). */
export function RecordSyncStatus() {
  const handle = useOfflineRecordStatus()
  return <DraftSyncIndicator state={handle.state} onRetry={handle.retry} />
}

/** The recovery / conflict / stranded-edits banner (render once, above the form). */
export function RecordSyncBanner() {
  const handle = useOfflineRecordStatus()
  return (
    <DraftRecoveryBanner
      restored={handle.restored}
      conflict={handle.conflict}
      stranded={handle.stranded}
      onDismiss={handle.dismissRestored}
      onDiscard={handle.discardDeviceCopy}
      onTakeDeviceCopy={handle.takeDeviceCopy}
      onTakeSavedVersion={handle.takeSavedVersion}
      onDiscardStranded={handle.discardStranded}
    />
  )
}

/** Save state shown next to one field. */
export type FieldSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export type RecordFieldHandle<T> = {
  value: T
  /** Show a new value and write it to the device after a short pause. */
  change: (value: T) => void
  /** Show a new value and write it to the device now. */
  commit: (value?: T) => void
  saveState: FieldSaveState
  /** Why the server refused the value, when `saveState` is `error`. */
  error: string | null
  retry: () => void
  /** Editing is paused for the whole record. */
  paused: boolean
}

const noopSubscribe = () => () => {}

/**
 * Bind one editor to the record's queue. `fieldId` is the saver's op key
 * (a column name, or e.g. `criteria:<rowId>:answer`); `serverValue` is the
 * wire value the page rendered, in exactly the form the saver formats it.
 */
export function useRecordField<T>(fieldId: string, serverValue: T): RecordFieldHandle<T> {
  const { key, paused, bind, recordField, noteServerValue, retry } = useOfflineRecordFields()
  const [value, setValue] = useState<T>(serverValue)
  const latestRef = useRef(value)
  // The last value the server is known to hold (rendered or acknowledged).
  const confirmedRef = useRef<unknown>(serverValue)
  // Typed input not yet written to the device (ref for handlers, state for render).
  const uncommittedRef = useRef(false)
  const [typing, setTyping] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  const subscribe = useCallback(
    (listener: () => void) => (key ? getDraftSyncEngine().subscribe(key, listener) : () => {}),
    [key],
  )
  const status = useSyncExternalStore(
    key ? subscribe : noopSubscribe,
    () => (key ? getDraftSyncEngine().fieldStatus(key, fieldId) : 'none'),
    () => 'none',
  )
  const syncing = useSyncExternalStore(
    key ? subscribe : noopSubscribe,
    () => (key ? getDraftSyncEngine().getState(key).syncing : false),
    () => false,
  )

  const commit = useCallback(
    (next?: T) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      const committed = next === undefined ? latestRef.current : next
      latestRef.current = committed
      const wasUncommitted = uncommittedRef.current
      uncommittedRef.current = false
      setTyping(false)
      if (next !== undefined) setValue(next)
      // Blur without a change: nothing to queue.
      if (!wasUncommitted && next === undefined) return
      const current = key ? getDraftSyncEngine().fieldStatus(key, fieldId) : 'none'
      if (current === 'none' && jsonEqual(committed, confirmedRef.current)) return
      recordField(fieldId, committed)
    },
    [fieldId, key, recordField],
  )
  const commitRef = useRef(commit)
  useEffect(() => {
    commitRef.current = commit
  }, [commit])

  const change = useCallback((next: T) => {
    latestRef.current = next
    uncommittedRef.current = true
    setTyping(true)
    setValue(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => commitRef.current(), DEVICE_WRITE_DEBOUNCE_MS)
  }, [])

  useEffect(
    () =>
      bind(fieldId, {
        // What the server is known to hold for this field: the rendered value,
        // then every acknowledged save. Pages that keep the record in client
        // state (the journal workspace) never re-render the prop, so the prop
        // alone would hand later edits a stale base.
        server: () => confirmedRef.current,
        restore: (restored) => {
          if (timerRef.current) clearTimeout(timerRef.current)
          timerRef.current = null
          uncommittedRef.current = false
          setTyping(false)
          latestRef.current = restored as T
          setValue(restored as T)
        },
        flushInput: () => {
          if (uncommittedRef.current) commitRef.current()
        },
      }),
    [bind, fieldId],
  )

  // Unmounting (a section closing, navigation) must not drop typed input.
  useEffect(
    () => () => {
      if (uncommittedRef.current) commitRef.current()
    },
    [],
  )

  const serverKey = JSON.stringify(serverValue ?? null)
  const adoptedRef = useRef(serverKey)

  const serverKeyRef = useRef(serverKey)
  useEffect(() => {
    serverKeyRef.current = serverKey
  })

  // Pending → gone means the server acknowledged this field. Any server
  // render seen so far predates that acknowledgement, so it must not be
  // adopted over the value that was just confirmed (the refresh that follows
  // the sync brings the stored value). Watched on the engine itself, so it is
  // recorded before React re-renders the field.
  useEffect(() => {
    if (!key) return
    const engine = getDraftSyncEngine()
    let previous = engine.fieldStatus(key, fieldId)
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = engine.subscribe(key, () => {
      const next = engine.fieldStatus(key, fieldId)
      // Dropped because the record closed is not saved: no confirmation.
      if (previous === 'pending' && next === 'none' && !engine.getState(key).closed) {
        // The stored value the server acknowledged (input typed since then is
        // not on the server yet).
        const work = engine.getWork(key)
        confirmedRef.current =
          work?.kind === 'fields' && fieldId in work.known ? work.known[fieldId] : latestRef.current
        adoptedRef.current = serverKeyRef.current
        setSavedFlash(true)
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => setSavedFlash(false), SAVED_FLASH_MS)
      }
      previous = next
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [fieldId, key])

  // The server page re-rendered with a new value (this device's edit landing,
  // or someone else's): adopt it once this field has no unsent work.
  useEffect(() => {
    if (serverKey === adoptedRef.current || status !== 'none' || typing) return
    adoptedRef.current = serverKey
    const next = JSON.parse(serverKey) as T
    confirmedRef.current = next
    noteServerValue(fieldId, next)
    if (!jsonEqual(latestRef.current, next)) {
      latestRef.current = next
      setValue(next)
    }
  }, [fieldId, noteServerValue, serverKey, status, typing])

  const rejected = status.startsWith('rejected:') ? status.slice('rejected:'.length) : null
  const saveState: FieldSaveState = rejected
    ? 'error'
    : status === 'pending'
      ? syncing
        ? 'saving'
        : 'dirty'
      : status === 'conflict' || typing
        ? 'dirty'
        : savedFlash
          ? 'saved'
          : 'idle'

  return { value, change, commit, saveState, error: rejected, retry, paused }
}
