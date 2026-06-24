'use client'

// Persistent, unmissable banner shown on every page while an admin is "viewing
// as" another user. Renders the target + real actor, a live countdown to
// auto-expiry, and a one-click Exit that posts the stopImpersonation action.

import { useEffect, useState } from 'react'
import { UserCog } from 'lucide-react'
import { stopImpersonation } from '@/lib/impersonation-actions'

export function ImpersonationBanner({
  actorName,
  targetName,
  expiresAtMs,
}: {
  actorName: string
  targetName: string
  expiresAtMs: number
}) {
  // Null until mounted so SSR and first client render agree (the countdown
  // depends on the client clock — computing it during SSR would hydration-mismatch).
  const [remaining, setRemaining] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, expiresAtMs - Date.now()))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [expiresAtMs])

  const countdown =
    remaining === null
      ? null
      : remaining <= 0
        ? 'expiring…'
        : `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')} left`

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-rose-300 bg-rose-50 px-4 py-1.5 text-xs text-rose-900 sm:px-6 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-200">
      <UserCog size={14} className="shrink-0" />
      <span className="truncate">
        Viewing as <strong>{targetName}</strong>
        <span className="hidden text-rose-700/90 sm:inline dark:text-rose-300/80">
          {' '}
          — you are signed in as {actorName}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-3">
        {countdown ? (
          <span className="text-rose-700 tabular-nums dark:text-rose-300/80">{countdown}</span>
        ) : null}
        <form action={stopImpersonation}>
          <button
            type="submit"
            className="rounded-md border border-rose-400/60 bg-white/70 px-2 py-0.5 font-medium text-rose-800 hover:bg-white dark:border-rose-700 dark:bg-rose-900/40 dark:text-rose-100 dark:hover:bg-rose-900/70"
          >
            Exit
          </button>
        </form>
      </span>
    </div>
  )
}
