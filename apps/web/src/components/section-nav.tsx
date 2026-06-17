'use client'

// Sticky jump-nav for a single-page detail form. The whole form lives on one
// scrolling page (like the legacy product crews already know); these chips
// scroll to a section instead of navigating, with a scrollspy highlight and a
// completion tick per section.
//
// Shared primitive — used by the hazard-assessment and incident detail pages.

import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@beaconhs/ui'

export type SectionNavItem = {
  id: string
  label: string
  count?: number
  done?: boolean
}

export function SectionNav({ sections }: { sections: SectionNavItem[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? '')
  const navRef = useRef<HTMLElement>(null)

  // Scrollspy — highlight the topmost section currently in the reading band.
  // The observer only reports CHANGED entries, so we keep the full set of
  // intersecting sections ourselves; otherwise the highlight stalls whenever
  // a section leaves the band while the next one was already inside it.
  useEffect(() => {
    const targets = sections
      .map((s) => document.getElementById(`section-${s.id}`))
      .filter((el): el is HTMLElement => Boolean(el))
    if (targets.length === 0) return
    const order = new Map(targets.map((t, i) => [t.id, i]))
    const inBand = new Set<string>()
    // The page scrolls inside the layout's inner container, not the window —
    // anchor the observation band to it (fall back to viewport if missing).
    const root =
      targets[0]?.closest<HTMLElement>('.app-scroll') ??
      document.querySelector<HTMLElement>('.app-scroll')
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) inBand.add(e.target.id)
          else inBand.delete(e.target.id)
        }
        const topmost = [...inBand].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))[0]
        if (topmost) setActive(topmost.replace(/^section-/, ''))
      },
      // Band = the top 35% of the scroll area: a section highlights as its
      // content reaches the reading position, not when it merely peeks in
      // from the bottom.
      { root, rootMargin: '0px 0px -65% 0px' },
    )
    for (const t of targets) observer.observe(t)

    // Bottom-of-page edge case: a short final section may never reach the
    // band — when the container is scrolled out, highlight the last chip.
    const lastId = targets[targets.length - 1]?.id
    function onScroll() {
      if (!root || !lastId) return
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 8) {
        setActive(lastId.replace(/^section-/, ''))
      }
    }
    root?.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      root?.removeEventListener('scroll', onScroll)
    }
  }, [sections])

  // Keep the active chip in view inside the (horizontally scrollable) strip.
  useEffect(() => {
    navRef.current
      ?.querySelector<HTMLElement>(`[data-section="${active}"]`)
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [active])

  return (
    <nav
      ref={navRef}
      aria-label="Sections"
      className="flex [scrollbar-width:none] flex-nowrap items-center gap-1.5 overflow-x-auto pb-2 [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      {sections.map((s) => {
        const isActive = s.id === active
        return (
          <button
            key={s.id}
            type="button"
            data-section={s.id}
            onClick={() => {
              document
                .getElementById(`section-${s.id}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              setActive(s.id)
            }}
            className={cn(
              'inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm whitespace-nowrap transition-colors sm:min-h-0 sm:px-3 sm:py-1 sm:text-xs',
              isActive
                ? 'border-teal-700 bg-teal-700 font-medium text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:text-teal-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300',
            )}
          >
            {s.done ? (
              <Check size={12} className={isActive ? 'text-white' : 'text-emerald-600'} />
            ) : null}
            {s.label}
            {typeof s.count === 'number' ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] leading-none',
                  isActive
                    ? 'bg-white/20 text-white'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                )}
              >
                {s.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}
