'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from './utils'

// Z-INDEX SCALE (single source of truth — everything else in the app should
// stay below these unless it deliberately wants to overlay them).
//
//   sidebar      : z-10
//   header       : z-20
//   sticky-bars  : z-30   (bulk-action floating bars etc)
//   dropdowns    : z-40   (tenant-switcher, notifications, global-search)
//   drawer       : z-50   (right-side slide-in panel + its backdrop)
//   modal/dialog : z-60   (centre-screen confirmations + send-email dialogs)
//   toast        : z-70

export type DrawerSize = 'sm' | 'md' | 'lg' | 'xl' | 'full'

const SIZE_CLASS: Record<DrawerSize, string> = {
  sm: 'w-full sm:max-w-md',
  md: 'w-full sm:max-w-xl',
  lg: 'w-full sm:max-w-2xl',
  xl: 'w-full sm:max-w-4xl',
  full: 'w-full',
}

/**
 * Right-side slide-in drawer for sub-entity create/edit forms.
 *
 * Pattern: an entity's detail page (e.g. /equipment/[id]) renders the
 * <Drawer> on its server-side render with `open` driven by a `searchParam`
 * (so deep-linking works + browser back closes it + Server Actions can
 * redirect to "?" to dismiss).
 *
 * For client-driven open/close (no URL change), pass `open` from useState.
 *
 * - Renders via React portal into <body> so the drawer escapes any
 *   overflow-hidden parent (the AppShell main container).
 * - Backdrop click closes via the `onClose` callback (the page wires this
 *   to a Link with the cleared searchParam, or to setState).
 * - Esc closes too.
 * - Initial render uses CSS transition for slide-in / fade.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  size?: DrawerSize
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
    // Lock body scroll while open
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!mounted) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      aria-hidden={!open}
      className={cn(
        'fixed inset-0 z-50 transition-opacity duration-200',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Close drawer"
      />
      <aside
        role="dialog"
        aria-modal="true"
        className={cn(
          'absolute right-0 top-0 flex h-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-xl transition-transform duration-200',
          SIZE_CLASS[size],
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {(title || description) ? (
          <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
            <div className="min-w-0 space-y-0.5">
              {title ? (
                <h2 className="truncate text-base font-semibold text-slate-900">{title}</h2>
              ) : null}
              {description ? (
                <p className="text-sm text-slate-500">{description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              aria-label="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>
        ) : null}
        <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3">
            {footer}
          </footer>
        ) : null}
      </aside>
    </div>,
    document.body,
  )
}

/**
 * URL-state drawer wrapper for server-rendered pages.
 *
 * Usage on a detail page:
 *
 *   const params = await searchParams
 *   const drawerKey = params.drawer
 *
 *   <UrlDrawer open={drawerKey === 'add-log'} basePath={`/equipment/${id}`} title="Add log entry">
 *     <form action={addLogEntry} ...>...</form>
 *   </UrlDrawer>
 *
 * The "open" state is driven by `?drawer=<key>` in the URL. Closing
 * navigates to the same path without the drawer param. Browser back/
 * forward work. Linkable.
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
  // We can't use next/link from a UI primitive without a hard Next dep. The
  // page passes us a plain href; clicking the backdrop or the X uses
  // history.pushState to navigate without a full reload.
  function close() {
    if (typeof window === 'undefined') return
    window.history.pushState({}, '', closeHref)
    // Trigger a re-fetch of the route — Next listens for popstate.
    window.dispatchEvent(new PopStateEvent('popstate'))
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
