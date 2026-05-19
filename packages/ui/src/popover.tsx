'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from './utils'

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
  align = 'end',
  side = 'bottom',
  className,
  children,
}: {
  trigger: React.ReactElement
  open: boolean
  onOpenChange: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom'
  className?: string
  children: React.ReactNode
}) {
  const triggerRef = React.useRef<HTMLDivElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [rect, setRect] = React.useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const [mounted, setMounted] = React.useState(false)

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
    function onClick(e: MouseEvent) {
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
      document.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  return (
    <>
      <div ref={triggerRef} className="contents">{trigger}</div>
      {mounted && open && rect && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              className={cn(
                'fixed z-40 min-w-[12rem] rounded-md border border-slate-200 bg-white shadow-lg',
                className,
              )}
              style={{
                top: side === 'bottom' ? rect.top + rect.height + 4 : undefined,
                bottom: side === 'top' ? window.innerHeight - rect.top + 4 : undefined,
                left:
                  align === 'start'
                    ? rect.left
                    : align === 'end'
                      ? undefined
                      : rect.left + rect.width / 2,
                right:
                  align === 'end' ? window.innerWidth - (rect.left + rect.width) : undefined,
                transform: align === 'center' ? 'translateX(-50%)' : undefined,
              }}
              role="dialog"
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
