'use client'

// Startup animation only. Route fallbacks use skeletons and cannot re-open it.
// The head script hides the server-rendered overlay before first paint when
// this tab has already started the app.

import { useEffect, useState } from 'react'
import { cn } from '@beaconhs/ui'
import { BrandSplash } from './brand-logo'

const MIN_VISIBLE_MS = 2000 // full draw-in completes at ~1.9s
const REDUCED_MOTION_MIN_MS = 500 // static logo — no reason to linger
const FADE_MS = 400

type Phase = 'visible' | 'fading' | 'gone'

export function SplashScreen() {
  const [phase, setPhase] = useState<Phase>('visible')
  useEffect(() => {
    const skip = document.documentElement.dataset.beaconSplash === 'skip'
    const min = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? REDUCED_MOTION_MIN_MS
      : MIN_VISIBLE_MS
    // Streaming time counts toward startup, rather than adding two seconds
    // after hydration. Already-seen tabs are hidden by CSS before hydration.
    const remaining = skip ? 0 : Math.max(0, min - performance.now())
    const fadeT = setTimeout(() => setPhase('fading'), remaining)
    const goneT = setTimeout(
      () => {
        document.documentElement.dataset.beaconSplash = 'skip'
        setPhase('gone')
      },
      remaining + (skip ? 0 : FADE_MS),
    )
    return () => {
      clearTimeout(fadeT)
      clearTimeout(goneT)
    }
  }, [])

  if (phase === 'gone') return null
  return (
    <div
      aria-hidden
      data-boot-splash
      className={cn(
        'fixed inset-0 z-[100] transition-opacity ease-out',
        phase === 'visible' ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <BrandSplash />
    </div>
  )
}
