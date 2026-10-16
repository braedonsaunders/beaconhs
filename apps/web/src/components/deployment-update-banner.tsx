'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import {
  DEPLOYMENT_STALE_EVENT,
  deploymentIsStale,
  installDeploymentGuard,
  refreshAfterDeployment,
} from '@/lib/deployment-guard'
import { flushRecordSaves } from '@/lib/pending-record-saves'
import { confirmDialog } from '@/lib/confirm'

function subscribeToDeployment(listener: () => void) {
  window.addEventListener(DEPLOYMENT_STALE_EVENT, listener)
  return () => window.removeEventListener(DEPLOYMENT_STALE_EVENT, listener)
}

/** Refresh is explicit: native drafts sync first and unfinished forms get a warning. */
export function DeploymentUpdateBanner({ version }: { version: string }) {
  const t = useGeneratedValueTranslations()
  const stale = useSyncExternalStore(subscribeToDeployment, deploymentIsStale, () => false)
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    const guard = installDeploymentGuard(version)
    const check = () => {
      if (document.visibilityState === 'visible') void guard?.check()
    }
    window.addEventListener('online', check)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    check()
    const timer = window.setInterval(check, 60_000)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', check)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [version])

  if (!stale) return null

  async function refresh() {
    if (refreshing) return
    if (
      !(await confirmDialog({
        title: t('Refresh BeaconHS'),
        message: t(
          'Your journal and record edits will sync first. Check any unfinished form before refreshing. You will need to repeat the action you were trying.',
        ),
        confirmLabel: t('Refresh app'),
      }))
    )
      return
    setRefreshing(true)
    const reloading = await refreshAfterDeployment({
      flush: flushRecordSaves,
      reload: () => window.location.reload(),
      confirmUnsent: () =>
        confirmDialog({
          title: t('Some changes have not synced'),
          message: t(
            'Keep this page open to retry. Refreshing now may lose unfinished form entries or uploads. Do you still want to refresh?',
          ),
          confirmLabel: t('Refresh anyway'),
          tone: 'danger',
        }),
    })
    if (!reloading) setRefreshing(false)
  }

  return (
    <div
      role="alert"
      className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
    >
      <p>
        <GeneratedValue value="BeaconHS has been updated. Refresh the app before continuing." />
      </p>
      <Button size="sm" disabled={refreshing} onClick={() => void refresh()}>
        <RefreshCw size={14} className={refreshing ? 'animate-spin' : undefined} />
        <GeneratedValue value={refreshing ? 'Syncing changes…' : 'Refresh app'} />
      </Button>
    </div>
  )
}
