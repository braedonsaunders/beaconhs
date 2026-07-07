'use client'

// Decides when a guided tour runs. Mounted once in the (app) layout with the
// server-resolved availability (enabled + role-matched tour ids and the
// auto-start pick). Launch sources, in priority order:
//
//   1. ?walkthrough=<id> in the URL — /help "Start tour" links and the admin
//      Preview button. `&wt_preview=1` marks a preview: progress is never
//      recorded and availability gating is skipped (admins preview tours that
//      are disabled or scoped to other roles).
//   2. Auto-start: the server picked the first enabled auto-start tour this
//      user hasn't finished — shown once, shortly after the shell settles.
//
// On finish/skip the outcome is persisted via a server action so auto-start
// tours never replay.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { recordWalkthroughProgress } from '@/lib/walkthroughs/actions'
import { walkthroughById, type Walkthrough } from '@/lib/walkthroughs/registry'
import { WalkthroughPlayer } from './player.client'

const AUTO_START_DELAY_MS = 1200

type Active = { walkthrough: Walkthrough; preview: boolean }

export function WalkthroughProvider({
  availableIds,
  autoStartId,
}: {
  availableIds: string[]
  autoStartId: string | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [active, setActive] = useState<Active | null>(null)
  // Only ever offer the auto-start tour once per mount, even if it's dismissed
  // without a progress write failing through.
  const [autoConsumed, setAutoConsumed] = useState(false)

  const available = useMemo(() => new Set(availableIds), [availableIds])

  const requestedId = searchParams.get('walkthrough')
  const requestedPreview = searchParams.get('wt_preview') === '1'

  // The finish handler strips ?walkthrough= via router.replace, but this effect
  // can re-run (active just cleared) BEFORE the new searchParams land — which
  // would relaunch the tour it just closed. Remember the request we already
  // consumed; the ref resets once the param is actually gone, so clicking a
  // launch link again later still works.
  const consumedRequestRef = useRef<string | null>(null)

  // URL-requested tour (help links + admin preview).
  useEffect(() => {
    if (!requestedId) {
      consumedRequestRef.current = null
      return
    }
    if (active || consumedRequestRef.current === requestedId) return
    const walkthrough = walkthroughById(requestedId)
    if (!walkthrough) return
    if (!requestedPreview && !available.has(walkthrough.id)) return
    consumedRequestRef.current = requestedId
    setActive({ walkthrough, preview: requestedPreview })
  }, [requestedId, requestedPreview, available, active])

  // First-run auto-start.
  useEffect(() => {
    if (!autoStartId || autoConsumed || active || requestedId) return
    const walkthrough = walkthroughById(autoStartId)
    if (!walkthrough) return
    const t = window.setTimeout(() => {
      setAutoConsumed(true)
      setActive({ walkthrough, preview: false })
    }, AUTO_START_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [autoStartId, autoConsumed, active, requestedId])

  const handleFinish = useCallback(
    (status: 'completed' | 'dismissed') => {
      const current = active
      setActive(null)
      // Drop the launch params so a refresh doesn't replay the tour.
      if (searchParams.get('walkthrough')) {
        const params = new URLSearchParams(searchParams.toString())
        params.delete('walkthrough')
        params.delete('wt_preview')
        const qs = params.toString()
        router.replace((qs ? `${pathname}?${qs}` : pathname) as never, { scroll: false })
      }
      if (current && !current.preview) {
        void recordWalkthroughProgress(current.walkthrough.id, status)
      }
    },
    [active, pathname, router, searchParams],
  )

  if (!active) return null
  return <WalkthroughPlayer walkthrough={active.walkthrough} onFinish={handleFinish} />
}
