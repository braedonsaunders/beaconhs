'use client'

// Live monitoring panel for a monitored-session response. Renders a ticking
// countdown to the next check-in, a one-tap "I'm OK" check-in (with optional
// GPS), end/cancel, and recent check-ins. Server-side, the worker scan escalates
// missed sessions; a check-in here re-activates an escalated one.

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Square } from 'lucide-react'
import { Badge, Button } from '@beaconhs/ui'
import { cancelSession, endSession, recordSessionCheckin } from './_monitor-actions'

export type MonitorStatus = 'active' | 'completed' | 'missed' | 'escalated' | 'cancelled'
const STATUS_BADGE: Record<
  MonitorStatus,
  { label: string; variant: 'success' | 'destructive' | 'secondary' | 'outline' }
> = {
  active: { label: 'Active', variant: 'success' },
  escalated: { label: 'Escalated', variant: 'destructive' },
  missed: { label: 'Missed', variant: 'destructive' },
  completed: { label: 'Completed', variant: 'secondary' },
  cancelled: { label: 'Cancelled', variant: 'outline' },
}

function mmss(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function MonitorPanel({
  responseId,
  monitorStatus,
  nextCheckinDueAt,
  intervalMinutes,
  requireGeo,
  readOnly,
  history,
}: {
  responseId: string
  monitorStatus: MonitorStatus
  nextCheckinDueAt: string | null
  intervalMinutes: number | null
  requireGeo: boolean
  readOnly: boolean
  history?: React.ReactNode
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [nowTs, setNowTs] = useState(() => Date.now())

  const live =
    monitorStatus === 'active' || monitorStatus === 'escalated' || monitorStatus === 'missed'

  useEffect(() => {
    if (!live) return
    const t = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [live])

  const dueMs = nextCheckinDueAt ? new Date(nextCheckinDueAt).getTime() : null
  const remaining = dueMs != null ? dueMs - nowTs : null
  const overdue = remaining != null && remaining < 0
  const escalated = monitorStatus === 'escalated' || monitorStatus === 'missed'

  function doCheckin() {
    setErr(null)
    const run = (geo?: { lat: number; lng: number }) =>
      start(async () => {
        const res = await recordSessionCheckin({
          responseId,
          geoLat: geo?.lat ?? null,
          geoLng: geo?.lng ?? null,
        })
        if (!res.ok) setErr(res.error)
        else router.refresh()
      })
    if (requireGeo && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => run({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => run(), // proceed without geo if the worker denies permission
        { enableHighAccuracy: true, timeout: 8000 },
      )
    } else {
      run()
    }
  }

  function doClose(fn: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>) {
    setErr(null)
    start(async () => {
      const res = await fn(responseId)
      if (!res.ok) setErr(res.error)
      else router.refresh()
    })
  }

  const badge = STATUS_BADGE[monitorStatus]
  const countdownColor = escalated
    ? 'text-red-600 dark:text-red-400'
    : overdue
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-teal-700 dark:text-teal-300'

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Live session monitoring
        </h3>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>

      {escalated ? (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          Check-in missed — supervisor and safety roles have been alerted.
          {readOnly ? '' : ' A check-in below re-activates the session.'}
        </div>
      ) : null}

      {live ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {overdue ? 'Check-in overdue by' : 'Next check-in in'}
            </div>
            <div className={`font-mono text-2xl font-bold tabular-nums ${countdownColor}`}>
              {remaining != null ? mmss(remaining) : '—'}
            </div>
            {intervalMinutes ? (
              <div className="text-xs text-slate-400">every {intervalMinutes} min</div>
            ) : null}
          </div>
          {!readOnly ? (
            <div className="flex items-center gap-2">
              <Button onClick={doCheckin} disabled={pending} size="lg">
                {pending ? (
                  <Loader2 size={16} className="mr-1.5 animate-spin" />
                ) : (
                  <Check size={16} />
                )}
                I&apos;m OK — check in
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          This session is {badge.label.toLowerCase()}.
        </p>
      )}

      {err ? (
        <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {err}
        </p>
      ) : null}

      {live && !readOnly ? (
        <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <Button
            variant="outline"
            size="sm"
            onClick={() => doClose(endSession)}
            disabled={pending}
          >
            <Square size={13} /> End session
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => doClose(cancelSession)}
            disabled={pending}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      {history}
    </div>
  )
}
