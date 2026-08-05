'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

/**
 * App pages own their scroll container instead of scrolling the document. Reset
 * those containers after a route change so mobile browser chrome and cached
 * scroll positions cannot leave the newly opened page above the visible area.
 */
export function AppScrollReset() {
  const pathname = usePathname()

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      document.querySelectorAll<HTMLElement>('[data-app-main] .app-scroll').forEach((root) => {
        root.scrollTo({ top: 0, left: 0 })
      })
    })

    return () => cancelAnimationFrame(frame)
  }, [pathname])

  return null
}
