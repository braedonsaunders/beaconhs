'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
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

export type DrawerSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'
export type DrawerSide = 'left' | 'right'

const SIZE_CLASS: Record<DrawerSize, string> = {
  sm: 'w-full sm:max-w-md',
  md: 'w-full sm:max-w-xl',
  lg: 'w-full sm:max-w-2xl',
  xl: 'w-full sm:max-w-4xl',
  full: 'w-full',
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
}: {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  size?: DrawerSize
  side?: DrawerSide
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  React.useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
            onClick={onClose}
            aria-label="Close drawer"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            initial={{ x: side === 'left' ? '-100%' : '100%' }}
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
                    <h2 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
                      {title}
                    </h2>
                  ) : null}
                  {description ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                  aria-label="Close"
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
            <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5 text-slate-900 dark:text-slate-100">
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
