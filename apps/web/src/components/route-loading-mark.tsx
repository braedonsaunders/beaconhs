'use client'

// Standalone loading mark for in-shell route transitions. The full draw-in is
// rewarding the first time, but quick in-and-out navigation would replay it
// like a splash screen — so the theatrical draw plays at most once per
// cooldown window; hops inside the window get the quiet pulsing beacon.

import { useState } from 'react'
import { LogoMark } from './brand-logo'

const DRAW_COOLDOWN_MS = 60_000
let lastDrawAt = -Infinity

export function RouteLoadingMark({ className }: { className?: string }) {
  // Decided once per mount via the state initializer. On the server (initial
  // document streams, where the boot splash covers the screen anyway) always
  // render the draw so SSR and first client render agree; the client
  // initializer also starts the cooldown for subsequent soft navigations.
  const [draw] = useState(() => {
    if (typeof window === 'undefined') return true
    const now = Date.now()
    if (now - lastDrawAt < DRAW_COOLDOWN_MS) return false
    lastDrawAt = now
    return true
  })
  return <LogoMark draw={draw} animated={!draw} className={className} />
}
