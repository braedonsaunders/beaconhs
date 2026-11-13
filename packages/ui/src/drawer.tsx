'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Skeleton } from './skeleton'
import { useUiText } from './text-context'
import { cn } from './utils'

// Z-INDEX SCALE (single source of truth)
//
//   sidebar      : z-10
//   header       : z-20
//   sticky-bars  : z-30
//   dropdowns    : z-40
//   drawer       : z-50
//   modal/dialog : z-60
//   toast        : z-70

export type DrawerSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'
export type DrawerSide = 'left' | 'right'

const SIZE_CLASS: Record<DrawerSize, string> = {
  sm: 'w-full sm:max-w-md',
  md: 'w-full sm:max-w-xl',
  lg: 'w-full sm:max-w-2xl',
  xl: 'w-full sm:max-w-4xl',
  '2xl': 'w-full sm:max-w-6xl',
  full: 'w-full',
}

// ---- Instant open for URL drawers -------------------------------------------
//
// A URL drawer opens when the server re-renders its page with `?drawer=…`.
// Waiting for that round trip leaves the click looking dead. The host app calls
// `beginPendingDrawer()` the moment such a link is clicked: a loading panel
// slides out at once over the unchanged page, and the real drawer takes it over
// in place (no second slide) when the server's content arrives.

type PendingDrawerState = { size: DrawerSize; key: string | null; adopted: boolean } | null

type PendingDrawerApi = {
  pending: PendingDrawerState
  /** Called by a drawer that opens while the loading panel is showing, with its real size. */
  adopt: (size: DrawerSize) => void
}

const PendingDrawerContext = React.createContext<PendingDrawerApi | null>(null)

/** Fast responses skip the loading panel and slide the real drawer in as usual. */
const PENDING_DRAWER_DELAY_MS = 120
/** A navigation that never opens a drawer (error, redirect) must not strand the panel. */
const PENDING_DRAWER_TIMEOUT_MS = 20_000

/**
 * Hosts the loading panel for URL drawers. The host app calls
 * `settlePendingDrawer()` after every navigation: when one lands without
 * opening a drawer, the panel slides back out.
 */
export function PendingDrawerProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<PendingDrawerState>(null)
  // Each drawer's real size, learned when it takes over, so the next loading
  // panel for it opens at the right width.
  const sizes = React.useRef(new Map<string, DrawerSize>())
  const timers = React.useRef<number[]>([])
  const clearTimers = React.useCallback(() => {
    for (const timer of timers.current) window.clearTimeout(timer)
    timers.current = []
  }, [])
  const adopt = React.useCallback(
    (size: DrawerSize) => {
      clearTimers()
      setPending((current) => {
        if (!current || current.adopted) return current
        if (current.key) sizes.current.set(current.key, size)
        return { ...current, adopted: true }
      })
    },
    [clearTimers],
  )

  React.useEffect(() => {
    function onBegin(event: Event) {
      const detail = (event as CustomEvent<{ size?: DrawerSize; key?: string }>).detail
      const key = detail?.key ?? null
      const size = (key ? sizes.current.get(key) : undefined) ?? detail?.size ?? 'md'
      clearTimers()
      timers.current.push(
        window.setTimeout(() => setPending({ size, key, adopted: false }), PENDING_DRAWER_DELAY_MS),
        window.setTimeout(() => setPending(null), PENDING_DRAWER_TIMEOUT_MS),
      )
    }
    // The navigation landed. A drawer that opened has already adopted the panel
    // (in its layout effect); otherwise nothing is coming, so put it away.
    function onSettle() {
      clearTimers()
      // Keep a handed-over panel marked as such: it must vanish under the real
      // drawer, not slide back out as if the navigation had been abandoned.
      setPending((current) => (current?.adopted ? current : null))
    }
    window.addEventListener(PENDING_DRAWER_EVENT, onBegin)
    window.addEventListener(PENDING_DRAWER_SETTLE_EVENT, onSettle)
    return () => {
      window.removeEventListener(PENDING_DRAWER_EVENT, onBegin)
      window.removeEventListener(PENDING_DRAWER_SETTLE_EVENT, onSettle)
      clearTimers()
    }
  }, [clearTimers])

  const api = React.useMemo(() => ({ pending, adopt }), [pending, adopt])
  return (
    <PendingDrawerContext.Provider value={api}>
      {children}
      <PendingDrawerPanel pending={pending} />
    </PendingDrawerContext.Provider>
  )
}

const PENDING_DRAWER_EVENT = 'beaconhs:pending-drawer'
const PENDING_DRAWER_SETTLE_EVENT = 'beaconhs:pending-drawer-settle'

/**
 * Show the loading panel for a URL drawer that is about to open. `key` names the
 * drawer (e.g. its page and `?drawer=` value) so its learned size is reused;
 * `size` is the guess when that drawer has not opened yet.
 */
export function beginPendingDrawer(size: DrawerSize = 'md', key?: string) {
  window.dispatchEvent(new CustomEvent(PENDING_DRAWER_EVENT, { detail: { size, key } }))
}

/** A navigation finished: drop a loading panel no drawer took over. */
export function settlePendingDrawer() {
  window.dispatchEvent(new Event(PENDING_DRAWER_SETTLE_EVENT))
}

const PANEL_SPRING = { type: 'spring', damping: 32, stiffness: 320, mass: 0.8 } as const

const PENDING_BACKDROP = {
  hidden: (handedOver: boolean) => ({
    opacity: 0,
    transition: { duration: handedOver ? 0 : 0.15 },
  }),
  shown: { opacity: 1, transition: { duration: 0.15 } },
}

const PENDING_PANEL = {
  hidden: (handedOver: boolean) =>
    handedOver
      ? { opacity: 0, transition: { duration: 0 } }
      : { x: '100%', transition: PANEL_SPRING },
  shown: { x: 0, opacity: 1, transition: PANEL_SPRING },
}

function PendingDrawerPanel({ pending }: { pending: PendingDrawerState }) {
  const t = useUiText()
  if (typeof document === 'undefined') return null
  // Handed over to the real drawer: vanish under it. Abandoned: slide back out.
  // Exiting children read this from AnimatePresence, never from their own
  // (stale) props.
  const handedOver = Boolean(pending?.adopted)
  return createPortal(
    <AnimatePresence custom={handedOver}>
      {pending && !pending.adopted ? (
        <div key="pending-drawer" className="fixed inset-0 z-50">
          <motion.div
            variants={PENDING_BACKDROP}
            initial="hidden"
            animate="shown"
            exit="hidden"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
            aria-hidden="true"
          />
          <motion.aside
            role="status"
            aria-busy="true"
            aria-label={t('Loading…')}
            variants={PENDING_PANEL}
            initial="hidden"
            animate="shown"
            exit="hidden"
            className={cn(
              'absolute top-0 right-0 flex h-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900',
              SIZE_CLASS[pending.size],
            )}
          >
            <header className="space-y-2 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-72 max-w-full" />
            </header>
            <div className="space-y-5 px-6 py-5">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="space-y-2">
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ))}
            </div>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}

/**
 * Slide-in drawer for sub-entity create/edit forms and mobile flyouts.
 * Portals to body, spring slide-in, backdrop fade, Esc + click-out + scroll lock.
 * Slides from the right by default; pass `side="left"` for nav-style flyouts.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  size = 'md',
  side = 'right',
  children,
  footer,
  bodyClassName,
}: {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  size?: DrawerSize
  side?: DrawerSide
  children: React.ReactNode
  footer?: React.ReactNode
  /** Override the body wrapper's classes (default: scroll + px-6 py-5 padding).
   *  Pass e.g. "overflow-hidden" for a child that manages its own layout/scroll. */
  bodyClassName?: string
}) {
  const t = useUiText()
  const titleId = React.useId()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  // Opening over the loading panel: take its place without sliding in again.
  const pendingDrawer = React.useContext(PendingDrawerContext)
  const takeOver = Boolean(open && pendingDrawer?.pending && !pendingDrawer.pending.adopted)
  const adoptPending = pendingDrawer?.adopt
  React.useLayoutEffect(() => {
    if (takeOver) adoptPending?.(size)
  }, [takeOver, adoptPending, size])

  const panelRef = React.useRef<HTMLElement>(null)

  React.useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      const activeDialog = document.activeElement?.closest('[role="dialog"][aria-modal="true"]')
      if (
        e.defaultPrevented ||
        (activeDialog &&
          activeDialog !== panelRef.current &&
          !panelRef.current?.contains(activeDialog))
      )
        return
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  // Focus management: on open, remember the previously focused element and move
  // focus into the dialog; trap Tab within the panel; restore focus on close.
  React.useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusablesSelector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

    // Defer the initial focus until the panel has mounted for this open cycle.
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      const activeDialog = document.activeElement?.closest('[role="dialog"][aria-modal="true"]')
      if (activeDialog && activeDialog !== panel && !panel.contains(activeDialog)) return
      const first = panel.querySelector<HTMLElement>(focusablesSelector)
      ;(first ?? panel).focus()
    }, 0)

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(focusablesSelector)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (focusables.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const firstEl = focusables[0]!
      const lastEl = focusables[focusables.length - 1]!
      const activeEl = document.activeElement
      if (e.shiftKey) {
        if (activeEl === firstEl || activeEl === panel || !panel.contains(activeEl)) {
          e.preventDefault()
          lastEl.focus()
        }
      } else if (activeEl === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      // Restore focus to the trigger if it's still in the document.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
  }, [open])

  if (typeof document === 'undefined') return null

  // The child must go absent → present for AnimatePresence to play the enter
  // animation. We mount the portal (empty) on the first client render, then add
  // the panel once `mounted` flips — otherwise a drawer that's open on initial
  // page load (e.g. deep-linked `?drawer=…`) renders at its `initial` x:100%
  // and never slides on-screen, leaving the panel + close button off the right
  // edge. See the off-screen-drawer bug.
  return createPortal(
    <AnimatePresence>
      {mounted && open ? (
        <div key="drawer" className="fixed inset-0 z-50">
          <motion.div
            initial={takeOver ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
            initial={takeOver ? false : { x: side === 'left' ? '-100%' : '100%' }}
            animate={{ x: 0 }}
            exit={{ x: side === 'left' ? '-100%' : '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320, mass: 0.8 }}
            className={cn(
              'absolute top-0 flex h-full flex-col overflow-hidden border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900',
              side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
              SIZE_CLASS[size],
            )}
          >
            {title || description ? (
              <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
                <div className="min-w-0 space-y-0.5">
                  {title ? (
                    <h2
                      id={titleId}
                      className="truncate text-base font-semibold text-slate-900 dark:text-slate-100"
                    >
                      {typeof title === 'string' ? t(title) : title}
                    </h2>
                  ) : null}
                  {description ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {typeof description === 'string' ? t(description) : description}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                  aria-label={t('Close')}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </header>
            ) : null}
            <div
              className={cn(
                'app-scroll min-h-0 flex-1 text-slate-900 dark:text-slate-100',
                bodyClassName ?? 'overflow-y-auto px-6 py-5',
              )}
            >
              {children}
            </div>
            {footer ? (
              <footer className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3 dark:border-slate-800 dark:bg-slate-900/60">
                {footer}
              </footer>
            ) : null}
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}

/**
 * Client-side navigate fn supplied by the host app (Next.js) so `UrlDrawer` can
 * close by changing the URL — which re-runs the server component that owns the
 * drawer's `open` state. The old implementation used a raw `history.pushState`,
 * which updates the URL but does NOT re-run the server, so the drawer never
 * closed (the X / backdrop / Esc appeared dead). The app wires this to
 * `router.push`; we fall back to a hard navigation if no provider is mounted.
 */
export const DrawerNavigateContext = React.createContext<((href: string) => void) | null>(null)

/**
 * URL-state drawer wrapper for server-rendered pages. `open` is derived from a
 * `?drawer=…` search param on the server, so closing needs a real navigation
 * (provided via DrawerNavigateContext) — not a shallow history update.
 */
export function UrlDrawer({
  open,
  closeHref,
  title,
  description,
  size,
  children,
  footer,
}: {
  open: boolean
  closeHref: string
  title?: React.ReactNode
  description?: React.ReactNode
  size?: DrawerSize
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const navigate = React.useContext(DrawerNavigateContext)
  function close() {
    if (typeof window === 'undefined') return
    if (navigate) navigate(closeHref)
    else window.location.assign(closeHref)
  }
  return (
    <Drawer
      open={open}
      onClose={close}
      title={title}
      description={description}
      size={size}
      footer={footer}
    >
      {children}
    </Drawer>
  )
}
