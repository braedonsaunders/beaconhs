'use client'

import { useEffect, useState } from 'react'

/** The usable screen, including Safari's keyboard and browser-bar changes. */
export function useVisualViewport(active: boolean) {
  const [viewport, setViewport] = useState<{
    top: number
    left: number
    width: number
    height: number
  } | null>(null)
  useEffect(() => {
    if (!active) return
    const visual = window.visualViewport
    const update = () =>
      setViewport({
        top: visual?.offsetTop ?? 0,
        left: visual?.offsetLeft ?? 0,
        width: visual?.width ?? window.innerWidth,
        height: visual?.height ?? window.innerHeight,
      })
    update()
    visual?.addEventListener('resize', update)
    visual?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      visual?.removeEventListener('resize', update)
      visual?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [active])
  return viewport
}
