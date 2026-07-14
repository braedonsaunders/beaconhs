'use client'

import { useEffect, useState } from 'react'
import { animate, useMotionValue } from 'framer-motion'

/**
 * Count-up animation for headline numbers. Eases from 0 -> value over ~0.85s
 * on mount using framer-motion's `animate()`. The caller passes a `format`
 * lambda so each tile controls its own precision (e.g. TRIR shows "1.23", an
 * integer count shows "123", a percent shows "92%").
 *
 * Why not motion.span + `style.count`? motion.span with a numeric prop forces
 * an arbitrary key, can't apply user-friendly formatting, and breaks text
 * wrapping. Bridging through React state is a few extra lines but gives us
 * exact control over the displayed string.
 */
export function AnimatedNumber({
  value,
  format,
  duration = 0.85,
  delay = 0,
  className,
}: {
  value: number
  format: (v: number) => string
  duration?: number
  delay?: number
  className?: string
}) {
  const mv = useMotionValue(0)
  const [displayValue, setDisplayValue] = useState(0)

  useEffect(() => {
    const unsub = mv.on('change', setDisplayValue)
    const controls = animate(mv, value, {
      duration,
      delay,
      ease: [0.22, 1, 0.36, 1],
    })
    return () => {
      controls.stop()
      unsub()
    }
  }, [delay, duration, mv, value])

  return <span className={className}>{format(displayValue)}</span>
}
