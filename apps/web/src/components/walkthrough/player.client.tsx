'use client'

// The guided-tour overlay: dims the app, spotlights the current step's target
// and shows a step card with Back / Next / Skip. Portaled to document.body —
// PageContainer's fade-in transform would otherwise capture position:fixed
// (see the fixed-overlay gotcha) — and fully keyboard/touch friendly.
//
// Steps degrade gracefully: when a step's target selector never appears (e.g.
// sidebar links on a phone, or a button the user lacks permission for), the
// step renders as a centered card so the tour still reads end to end.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { Button, cn } from '@beaconhs/ui'
import type { Walkthrough } from '@/lib/walkthroughs/registry'

const TARGET_WAIT_MS = 3000
const TARGET_POLL_MS = 120
const CARD_W = 320
const GAP = 10

type Rect = { top: number; left: number; width: number; height: number }
type TargetSnapshot = {
  step: Walkthrough['steps'][number] | undefined
  pathname: string
  rect: Rect | null
  state: 'looking' | 'found' | 'missing' | 'none'
}

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

export function WalkthroughPlayer({
  walkthrough,
  onFinish,
}: {
  walkthrough: Walkthrough
  /** Called exactly once when the tour ends, however it ends. */
  onFinish: (status: 'completed' | 'dismissed') => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [index, setIndex] = useState(0)
  const finishedRef = useRef(false)
  const step = walkthrough.steps[index]
  const total = walkthrough.steps.length
  const initialTargetState = !step?.target
    ? 'none'
    : step.path && pathname !== step.path
      ? 'looking'
      : 'looking'
  const [targetSnapshot, setTargetSnapshot] = useState<TargetSnapshot>({
    step,
    pathname,
    rect: null,
    state: initialTargetState,
  })
  const currentTarget =
    targetSnapshot.step === step && targetSnapshot.pathname === pathname
      ? targetSnapshot
      : ({ step, pathname, rect: null, state: initialTargetState } satisfies TargetSnapshot)
  const rect = currentTarget.rect
  // 'looking' while we poll for the target; 'missing' falls back to a centered card.
  const targetState = currentTarget.state

  const finish = useCallback(
    (status: 'completed' | 'dismissed') => {
      if (finishedRef.current) return
      finishedRef.current = true
      onFinish(status)
    },
    [onFinish],
  )

  // Navigate to the step's route when we're not already there.
  useEffect(() => {
    if (!step) return
    if (step.path && pathname !== step.path) router.push(step.path as never)
  }, [step, pathname, router])

  // Locate + track the step target. Re-runs on step and route changes.
  useEffect(() => {
    if (!step) return
    if (!step.target) return
    if (step.path && pathname !== step.path) {
      // Still navigating; keep looking without starting the miss timer yet.
      return
    }
    let cancelled = false
    let el: Element | null = null
    const started = Date.now()

    const track = () => {
      if (cancelled) return
      if (el && document.contains(el)) {
        setTargetSnapshot({ step, pathname, rect: rectOf(el), state: 'found' })
        return
      }
      el = document.querySelector(step.target!)
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as never })
        setTargetSnapshot({ step, pathname, rect: rectOf(el), state: 'found' })
      } else if (Date.now() - started > TARGET_WAIT_MS) {
        setTargetSnapshot({ step, pathname, rect: null, state: 'missing' })
        return // stop polling
      }
      timer = window.setTimeout(track, TARGET_POLL_MS)
    }
    let timer = window.setTimeout(track, 0)
    const onMove = () => {
      if (el && document.contains(el)) {
        setTargetSnapshot({ step, pathname, rect: rectOf(el), state: 'found' })
      }
    }
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [step, pathname])

  // Esc dismisses the tour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish('dismissed')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finish])

  const spotlight = targetState === 'found' && rect ? rect : null

  // Card placement: under the target when it fits, above otherwise; clamped to
  // the viewport. Phones always get a bottom sheet.
  const cardStyle = useMemo<React.CSSProperties | null>(() => {
    if (typeof window === 'undefined') return null
    const vw = window.innerWidth
    if (vw < 640) return null // bottom sheet
    if (!spotlight) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
    const left = Math.min(Math.max(GAP, spotlight.left), vw - CARD_W - GAP)
    const below = spotlight.top + spotlight.height + GAP
    const fitsBelow = below + 220 < window.innerHeight
    return fitsBelow
      ? { top: below, left }
      : { bottom: window.innerHeight - spotlight.top + GAP, left }
  }, [spotlight])

  if (!step) return null

  const isLast = index === total - 1
  const waiting = targetState === 'looking'

  return createPortal(
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label={step.title}>
      {/* Dimmer. With a spotlight the hole is punched via box-shadow. */}
      {spotlight ? (
        <div
          aria-hidden
          className="absolute rounded-lg ring-2 ring-teal-400 transition-all duration-200"
          style={{
            top: spotlight.top - 4,
            left: spotlight.left - 4,
            width: spotlight.width + 8,
            height: spotlight.height + 8,
            boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.6)',
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-slate-950/60" />
      )}

      {/* Step card — desktop floats near the target, phones get a bottom sheet. */}
      <div
        className={cn(
          'absolute rounded-xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900',
          'inset-x-3 bottom-3 sm:inset-x-auto sm:bottom-auto sm:w-80',
        )}
        style={cardStyle ?? undefined}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="text-[11px] font-semibold tracking-wide text-teal-700 uppercase dark:text-teal-300">
            {walkthrough.title} · {index + 1}/{total}
          </div>
          <button
            type="button"
            onClick={() => finish('dismissed')}
            aria-label="Close tour"
            className="rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X size={15} />
          </button>
        </div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{step.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {waiting ? 'One moment…' : step.body}
        </p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => finish('dismissed')}
            className="text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <Button variant="outline" size="sm" onClick={() => setIndex((i) => i - 1)}>
                Back
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => (isLast ? finish('completed') : setIndex((i) => i + 1))}
            >
              {isLast ? 'Done' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
