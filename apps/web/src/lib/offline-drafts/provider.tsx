'use client'

// Mounted once in the authenticated layout. Supplies the device-store scope
// (tenant + signed-in user, plus the real admin while impersonating) to every
// form filler, and drives the background sync queue: it drains pending
// device copies when the app loads, when the connection returns, when the tab
// becomes visible again, and on a fixed interval — so a draft saved in a dead
// zone reaches the server even if its form is never reopened.

import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useGeneratedTranslations } from '@/i18n/generated'
import { confirmDialog } from '@/lib/confirm'
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

  const prepareSignOut = useCallback(async () => {
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
  }, [scopeKey, tGenerated, userId])

  const value = useMemo(
    () => ({ scope: { tenantId, userId, actorUserId }, scopeKey, prepareSignOut }),
    [actorUserId, prepareSignOut, scopeKey, tenantId, userId],
  )

  return <OfflineDraftsContext.Provider value={value}>{children}</OfflineDraftsContext.Provider>
}
