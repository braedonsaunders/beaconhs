'use client'

// Sync indicator + recovery banner for local-first form drafts
// (see apps/web/src/lib/offline-drafts). The indicator tells a crew whether
// it is safe to close the form: "Synced" means the server has everything,
// "Saved on device · Pending (n)" means the phone has it and will send it.

import { AlertTriangle, Check, Cloud, CloudOff, HardDrive, History } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle, Button } from '@beaconhs/ui'
import {
  GeneratedText,
  GeneratedValue,
  useGeneratedTranslations,
  useGeneratedValueTranslations,
} from '@/i18n/generated'
import type { DraftSyncState } from '@/lib/offline-drafts/engine'

const PILL = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium'

function PendingCount({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-white/70 px-1.5 text-[10px] font-semibold tabular-nums dark:bg-slate-950/40">
      <GeneratedText id="m_049b66568efd8d" values={{ value0: count }} />
    </span>
  )
}

export function DraftSyncIndicator({
  state,
  onRetry,
}: {
  state: DraftSyncState | null
  onRetry: () => void
}) {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  if (!state) return null
  const onDevice = state.storage === 'device'

  let content: React.ReactNode = null
  if (state.blocked === 'rejected') {
    content = (
      <button
        type="button"
        onClick={onRetry}
        title={state.error ? tGeneratedValue(state.error) : undefined}
        className={`${PILL} bg-rose-50 text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/60 dark:hover:bg-rose-950/70`}
      >
        <CloudOff size={11} />
        <GeneratedText id="m_11a2a9cf44e821" />
        {state.pending > 0 ? <PendingCount count={state.pending} /> : null}
      </button>
    )
  } else if (state.blocked === 'conflict' || state.closed) {
    content = (
      <span
        title={state.error ? tGeneratedValue(state.error) : undefined}
        className={`${PILL} bg-rose-50 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/60`}
      >
        <CloudOff size={11} />
        <GeneratedText id="m_0f7a5c90a0db78" />
      </span>
    )
  } else if (state.pending > 0 && state.offline) {
    content = (
      <span
        title={tGenerated(onDevice ? 'm_0c957732c954d2' : 'm_1b204a8d445131')}
        className={`${PILL} bg-amber-50 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-900/60`}
      >
        <CloudOff size={11} />
        <GeneratedText id={onDevice ? 'm_1f890d78b83796' : 'm_1bb818160e6c16'} />
        <PendingCount count={state.pending} />
      </span>
    )
  } else if (state.pending > 0) {
    content = (
      <span
        title={
          state.error
            ? tGeneratedValue(state.error)
            : tGenerated(onDevice ? 'm_0c957732c954d2' : 'm_1b204a8d445131')
        }
        className={`${PILL} bg-sky-50 text-sky-800 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-900/60`}
      >
        {state.syncing ? (
          <Cloud size={11} className="animate-pulse" />
        ) : onDevice ? (
          <HardDrive size={11} />
        ) : (
          <Cloud size={11} />
        )}
        <GeneratedValue
          value={
            state.syncing ? (
              <GeneratedText id="m_06ea57651ac92b" />
            ) : onDevice ? (
              <GeneratedText id="m_07e9ebe49169b0" />
            ) : (
              <GeneratedText id="m_106811f2aac664" />
            )
          }
        />
        <PendingCount count={state.pending} />
      </span>
    )
  } else if (state.offline) {
    content = (
      <span
        className={`${PILL} bg-slate-100 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700`}
      >
        <CloudOff size={11} />
        <GeneratedText id="m_19642a2b0ca412" />
      </span>
    )
  } else if (state.lastSyncedAt !== null) {
    content = (
      <span
        title={tGenerated('m_087ca847710523')}
        className={`${PILL} bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/60`}
      >
        <Check size={11} />
        <GeneratedText id="m_07ba2e86a6e153" />
      </span>
    )
  }

  if (!content) return null
  return (
    <span aria-live="polite" className="inline-flex">
      <GeneratedValue value={content} />
    </span>
  )
}

export function DraftRecoveryBanner({
  restored,
  conflict,
  onDismiss,
  onDiscard,
  onTakeDeviceCopy,
  onTakeSavedVersion,
}: {
  restored: { origin: 'new' | 'resume' } | null
  conflict: boolean
  onDismiss: () => void
  onDiscard: () => void
  onTakeDeviceCopy: () => void
  onTakeSavedVersion: () => void
}) {
  if (conflict) {
    return (
      <Alert variant="warning">
        <div className="flex gap-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <AlertTitle>
                <GeneratedText id="m_1bb4f54a6e7cc6" />
              </AlertTitle>
              <AlertDescription>
                <GeneratedText id="m_00fa5517e44491" />
              </AlertDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={onTakeDeviceCopy}>
                <GeneratedText id="m_0bc7a210053b63" />
              </Button>
              <Button size="sm" variant="outline" onClick={onTakeSavedVersion}>
                <GeneratedText id="m_11732a5b37bebd" />
              </Button>
            </div>
          </div>
        </div>
      </Alert>
    )
  }
  if (!restored) return null
  return (
    <Alert variant="info">
      <div className="flex gap-3">
        <History size={18} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <AlertTitle>
              <GeneratedText id="m_04452848df1ed9" />
            </AlertTitle>
            <AlertDescription>
              <GeneratedText id="m_1c71b13b8c067e" />
            </AlertDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onDismiss}>
              <GeneratedText id="m_024331c508a2cd" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onDiscard}>
              <GeneratedValue
                value={
                  restored.origin === 'new' ? (
                    <GeneratedText id="m_0ba14ad63ece67" />
                  ) : (
                    <GeneratedText id="m_025492db675714" />
                  )
                }
              />
            </Button>
          </div>
        </div>
      </div>
    </Alert>
  )
}
