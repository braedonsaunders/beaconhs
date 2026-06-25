'use client'

// Lazy record creation — the "don't create an empty draft until the user
// actually starts" convention (ports the form-fill `createDraftResponse`
// pattern, generalised for any auto-saving record page).
//
// A `/<entity>/new` page renders the record's auto-saving fields inside
// <LazyRecordProvider>. The fields carry NO id. On the FIRST successful save,
// the provider's `ensureId()` creates the draft row exactly once, the field
// commits against the new id, and then we hand off to the real record URL —
// so a glance-and-leave creates nothing.
//
// Consumers (LiveField's useAutoSave, useDocumentAutosave, …) resolve their id
// via `useLazyRecord().ensureId()` when they weren't given one, and call
// `notifySaved()` after the first save so the provider can navigate.

import { createContext, useCallback, useContext, useRef } from 'react'
import { useRouter } from 'next/navigation'

export type LazyRecord = {
  /** Resolve the record id, creating the draft row on first call. Null on failure. */
  ensureId: () => Promise<string | null>
  /** Called after a successful save; navigates to the real record after the first one. */
  notifySaved: () => void
}

const LazyRecordContext = createContext<LazyRecord | null>(null)

/** Null when not inside a lazy "new record" page (i.e. an existing record). */
export function useLazyRecord(): LazyRecord | null {
  return useContext(LazyRecordContext)
}

export function LazyRecordProvider({
  createDraft,
  recordHref,
  children,
}: {
  createDraft: () => Promise<{ ok: true; id: string } | { ok: false; error: string }>
  /** Target record URL with a `{id}` placeholder, e.g. `/training/classes/{id}`.
   *  A plain string so it's serializable from a server page. */
  recordHref: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const idRef = useRef<string | null>(null)
  const pending = useRef<Promise<string | null> | null>(null)
  const navigated = useRef(false)

  const ensureId = useCallback(async () => {
    if (idRef.current) return idRef.current
    if (pending.current) return pending.current
    pending.current = (async () => {
      const res = await createDraft()
      if (!res.ok) {
        pending.current = null
        return null
      }
      idRef.current = res.id
      return res.id
    })()
    return pending.current
  }, [createDraft])

  const notifySaved = useCallback(() => {
    // After the first save against the freshly-created row, swap to the real
    // record URL (full record page + tabs). Guarded to fire once; the save has
    // already resolved by the time this runs, so nothing is lost on unmount.
    if (navigated.current || !idRef.current) return
    navigated.current = true
    router.replace(recordHref.replace('{id}', idRef.current))
  }, [router, recordHref])

  return (
    <LazyRecordContext.Provider value={{ ensureId, notifySaved }}>
      {children}
    </LazyRecordContext.Provider>
  )
}
