'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from './utils'
import { useVisualViewport } from './use-visual-viewport'

/**
 * Portal-based popover that escapes any overflow-hidden ancestor.
 *
 * Use this for header/sidebar dropdowns (tenant switcher, notifications,
 * global search results, profile menu). The trigger button stays in its
 * normal position; the floating panel is rendered into <body> at a fixed
 * position computed from the button's bounding rect.
 */
export function Popover({
  trigger,
  open,
  onOpenChange,
  matchTriggerWidth = false,
  align = 'end',
  side = 'bottom',
  className,
  children,
  keepMounted = false,
  ariaLabel,
}: {
  trigger: React.ReactElement
  open: boolean
  onOpenChange: (open: boolean) => void
  matchTriggerWidth?: boolean
  align?: 'start' | 'end'
  side?: 'top' | 'bottom'
  className?: string
  children: React.ReactNode
  /** Keep action forms connected while an external confirmation dialog has focus. */
  keepMounted?: boolean
  ariaLabel?: string
}) {
  const triggerRef = React.useRef<HTMLDivElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [rect, setRect] = React.useState<{
    top: number
    left: number
    width: number
    height: number
  } | null>(null)
  const [mounted, setMounted] = React.useState(false)
  const viewport = useVisualViewport(open)

  React.useEffect(() => setMounted(true), [])

  React.useEffect(() => {
    if (!open) return
    const t = triggerRef.current?.firstElementChild as HTMLElement | null
    if (!t) return
    function measure() {
      const r = t!.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])

  React.useEffect(() => {
    if (!open) return
    function onClick(e: Event) {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      onOpenChange(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false)
    }
    // Defer so the click that opened it doesn't immediately close.
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onClick)
      document.addEventListener('focusin', onClick)
      document.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('focusin', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  return (
    <>
      <div ref={triggerRef} className="contents">
        {trigger}
      </div>
      {mounted && rect && typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {open || keepMounted ? (
                <motion.div
                  ref={panelRef}
                  initial={{ opacity: 0, y: side === 'bottom' ? -4 : 4, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: side === 'bottom' ? -4 : 4, scale: 0.97 }}
                  transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                  className={cn(
                    'fixed z-[80] flex min-w-[12rem] origin-top flex-col overflow-y-auto overscroll-contain rounded-md border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900',
                    className,
                  )}
                  style={{
                    display: open ? undefined : 'none',
                    width: matchTriggerWidth ? rect.width : undefined,
                    ...(() => {
                      const screen = viewport ?? {
                        top: 0,
                        left: 0,
                        width: window.innerWidth,
                        height: window.innerHeight,
                      }
                      const below = screen.top + screen.height - rect.top - rect.height - 12
                      const above = rect.top - screen.top - 12
                      const up =
                        side === 'top'
                          ? above >= below || above >= 256
                          : below < 200 && above > below
                      const width = matchTriggerWidth
                        ? rect.width
                        : (panelRef.current?.offsetWidth ?? 256)
                      return {
                        left: Math.max(
                          screen.left + 8,
                          Math.min(
                            align === 'start' ? rect.left : rect.left + rect.width - width,
                            screen.left + screen.width - width - 8,
                          ),
                        ),
                        top: up ? undefined : Math.max(screen.top + 8, rect.top + rect.height + 4),
                        bottom: up ? window.innerHeight - rect.top + 4 : undefined,
                        maxHeight: Math.max(48, up ? above : below),
                        maxWidth: screen.width - 16,
                      }
                    })(),
                  }}
                  role="dialog"
                  aria-label={ariaLabel}
                >
                  {children}
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  )
}
