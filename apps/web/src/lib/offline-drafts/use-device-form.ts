'use client'

// Device copy of a one-shot form whose record does not exist until it is
// submitted (a PPE inspection is filled in a drawer and created in one call).
// The answers are written to the device as the worker goes (~300 ms after a
// change, immediately when the page hides), restored with the usual recovery
// banner if the tab is reloaded or discarded, and forgotten once the form is
// submitted. They are never synced on their own: submitting needs signal.

import { useCallback, useEffect, useRef, useState } from 'react'
import { getDraftSyncEngine, type DraftSyncState } from './engine'
import { localFormKey, type LocalWork } from './model'
import { DEVICE_WRITE_DEBOUNCE_MS } from './offline-record'
import { useOfflineDraftsContext } from './provider'
import { useDraftSyncState } from './use-draft-sync-state'

const CLAIM_WAIT_MS = 3_000

type HeldLock = { release: () => void }

export type DeviceFormHandle<T> = {
  state: DraftSyncState | null
  /** Answers recovered from the device when the form opened. */
  restored: { origin: 'new' } | null
  /** Record the form's current answers (debounced). */
  save: (values: T) => void
  /** Forget the device copy (submitted, or the worker started over). */
  clear: () => void
  dismissRestored: () => void
}

export function useDeviceForm<T extends Record<string, unknown>>(options: {
  enabled: boolean
  /** Which form, e.g. `ppe-inspection`. */
  form: string
  /** Which instance of it, e.g. the item and inspection kind. */
  localId: string
  /** Put recovered answers into the form. */
  onRestore: (values: T) => void
}): DeviceFormHandle<T> {
  const { enabled, form, localId } = options
  const context = useOfflineDraftsContext()
  const scopeKey = context?.scopeKey ?? null
  const scope = context?.scope ?? null
  const [key, setKey] = useState<string | null>(null)
  const [restored, setRestored] = useState<{ origin: 'new' } | null>(null)
  const keyRef = useRef<string | null>(null)
  const onRestoreRef = useRef(options.onRestore)
  useEffect(() => {
    onRestoreRef.current = options.onRestore
  })
  const pendingRef = useRef<T | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const writeNow = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    const values = pendingRef.current
    pendingRef.current = null
    if (values && keyRef.current) getDraftSyncEngine().recordLocal(keyRef.current, values)
  }, [])

  useEffect(() => {
    if (!enabled || !scopeKey) return
    let cancelled = false
    let lock: HeldLock | null = null
    const engine = getDraftSyncEngine()
    const formKey = localFormKey(scopeKey, form, localId)
    void (async () => {
      await engine.ready()
      if (cancelled) return
      lock = await engine.acquireLock(formKey, CLAIM_WAIT_MS)
      const stored = lock
        ? (engine.inMemoryRecord(formKey) ?? (await engine.readStored(formKey)))
        : null
      if (cancelled) {
        lock?.release()
        return
      }
      const work: LocalWork =
        stored?.work.kind === 'local' ? stored.work : { kind: 'local', sequence: 0, values: null }
      engine.open(
        {
          key: formKey,
          scope: scopeKey,
          tenantId: scope?.tenantId ?? '',
          userId: scope?.userId ?? '',
          target: 'local',
          form,
          localId,
        },
        work,
        { persist: lock !== null, owned: true },
      )
      keyRef.current = formKey
      setKey(formKey)
      if (work.values) {
        onRestoreRef.current(work.values as T)
        setRestored({ origin: 'new' })
      }
      // Answers given before the claim finished.
      writeNow()
    })()
    return () => {
      cancelled = true
      if (keyRef.current === formKey) {
        writeNow()
        engine.release(formKey)
        keyRef.current = null
      }
      lock?.release()
    }
  }, [enabled, form, localId, scope, scopeKey, writeNow])

  useEffect(() => {
    if (!enabled) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') writeNow()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', writeNow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', writeNow)
    }
  }, [enabled, writeNow])

  const save = useCallback(
    (values: T) => {
      pendingRef.current = values
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(writeNow, DEVICE_WRITE_DEBOUNCE_MS)
    },
    [writeNow],
  )

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    pendingRef.current = null
    if (keyRef.current) getDraftSyncEngine().clearLocal(keyRef.current)
    setRestored(null)
  }, [])

  const dismissRestored = useCallback(() => setRestored(null), [])

  return {
    state: useDraftSyncState(enabled ? key : null),
    restored,
    save,
    clear,
    dismissRestored,
  }
}
