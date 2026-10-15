'use client'

// Mounted once in the authenticated layout. Supplies the device-store scope
// (tenant + signed-in user, plus the real admin while impersonating) to every
// form filler and record page, and drives the background sync queue: it
// drains pending device copies when the app loads, when the connection
// returns, when the tab becomes visible again, and on a fixed interval — so
// work saved in a dead zone reaches the server even if its page is never
// reopened.
//
// It also enforces the online-only rule for everything that is not queued on
// the device. Field edits work offline; a form submission (creating a record,
// adding or removing rows, submitting, locking, signing, emailing) needs the
// server. While the browser reports no connection, any form submission is
// stopped before the Server Action runs and the worker is told why, instead of
// the request failing mid-flight. Forms that handle this themselves
// (<OnlineActionForm>) or that work without the server opt out with
// `data-offline-ok`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { useGeneratedTranslations } from '@/i18n/generated'
import { confirmDialog } from '@/lib/confirm'
import { toast } from '@/lib/toast'
import { getDraftSyncEngine } from './engine'
import { draftScopeKey, type DraftScope } from './model'

const DRAIN_INTERVAL_MS = 30_000
// Let a form on the page claim its own draft before the background queue runs.
const INITIAL_DRAIN_DELAY_MS = 1_500
const SIGN_OUT_SYNC_WAIT_MS = 5_000

type OfflineDraftsContextValue = {
  scope: DraftScope
  scopeKey: string
  /**
   * Run before signing out. Tries to sync, warns when unsynced device copies
   * would be lost, then removes this user's copies from the device. Resolves
   * false when the worker cancels.
   */
  prepareSignOut: () => Promise<boolean>
}

const OfflineDraftsContext = createContext<OfflineDraftsContextValue | null>(null)

export function useOfflineDraftsContext(): OfflineDraftsContextValue | null {
  return useContext(OfflineDraftsContext)
}

export function OfflineDraftsProvider({
  tenantId,
  userId,
  actorUserId,
  children,
}: {
  tenantId: string
  userId: string
  actorUserId: string | null
  children: ReactNode
}) {
  const tGenerated = useGeneratedTranslations()
  const scopeKey = draftScopeKey({ tenantId, userId, actorUserId })

  useEffect(() => {
    const engine = getDraftSyncEngine()
    engine.setOnline(navigator.onLine)
    const drain = (force: boolean) => {
      void engine.drain(scopeKey, { force })
    }
    const onOnline = () => {
      engine.setOnline(true)
      drain(true)
    }
    const onOffline = () => engine.setOnline(false)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') drain(true)
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisibility)
    const interval = window.setInterval(() => drain(false), DRAIN_INTERVAL_MS)
    const initial = window.setTimeout(() => drain(false), INITIAL_DRAIN_DELAY_MS)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(interval)
      window.clearTimeout(initial)
    }
  }, [scopeKey])

  useEffect(() => {
    const onSubmit = (event: SubmitEvent) => {
      if (navigator.onLine) return
      const form = event.target
      if (!(form instanceof HTMLFormElement) || form.hasAttribute('data-offline-ok')) return
      // Capture phase on window: runs before React's root listener, so the
      // Server Action is never started.
      event.preventDefault()
      event.stopImmediatePropagation()
      toast.error(tGenerated('m_1274068c9365ae'))
    }
    window.addEventListener('submit', onSubmit, true)
    return () => window.removeEventListener('submit', onSubmit, true)
  }, [tGenerated])

  // Translations get a new identity whenever the server re-renders the layout
  // (any revalidating Server Action). Read them through a ref so the context
  // value — and every claimed record keyed on it — only changes when the
  // signed-in scope does. A context that churned on each refresh made record
  // pages release and re-claim their queue mid-edit, losing the last
  // confirmed value the next edit is based on (false "changed somewhere else"
  // conflicts on journals after adding a photo).
  const tGeneratedRef = useRef(tGenerated)
  useEffect(() => {
    tGeneratedRef.current = tGenerated
  })

  const prepareSignOut = useCallback(async () => {
    const tGenerated = tGeneratedRef.current
    const engine = getDraftSyncEngine()
    await Promise.race([
      engine.drain(scopeKey, { force: true }),
      new Promise((resolve) => setTimeout(resolve, SIGN_OUT_SYNC_WAIT_MS)),
    ])
    const pending = await engine.pendingCountForUser(userId)
    if (pending > 0) {
      const confirmed = await confirmDialog({
        title: tGenerated('m_11a2fd169e0cf3'),
        message: tGenerated('m_1e550c8aff934b', { value0: pending }),
        confirmLabel: tGenerated('m_0f08243456ca7a'),
        tone: 'danger',
      })
      if (!confirmed) return false
    }
    await engine.purgeUser(userId)
    return true
  }, [scopeKey, userId])

  const scope = useMemo(() => ({ tenantId, userId, actorUserId }), [actorUserId, tenantId, userId])
  const value = useMemo(
    () => ({ scope, scopeKey, prepareSignOut }),
    [prepareSignOut, scope, scopeKey],
  )

  return <OfflineDraftsContext.Provider value={value}>{children}</OfflineDraftsContext.Provider>
}
