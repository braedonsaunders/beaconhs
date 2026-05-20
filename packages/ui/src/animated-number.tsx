'use client'

import * as React from 'react'
import { animate, useMotionValue, useReducedMotion } from 'framer-motion'

/**
 * Counts up from `from` (default 0) to `value` on mount using an eased
 * animation. Useful for KPI tiles and counters.
 *
 *   <AnimatedNumber value={42} />
 *   <AnimatedNumber value={1234.5} format={(n) => `$${n.toFixed(2)}`} />
 */
export function AnimatedNumber({
  value,
  from = 0,
  duration = 0.8,
  format,
  className,
  decimals,
}: {
  value: number
  from?: number
  /** Animation duration in seconds. */
  duration?: number
  /** Custom formatter. If omitted, the value is rounded to `decimals` (0). */
  format?: (n: number) => string
  className?: string
  /** Number of decimal places to render when no `format` is provided. */
  decimals?: number
}) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(reduce ? value : from)
  const [display, setDisplay] = React.useState(() =>
    formatValue(reduce ? value : from, format, decimals),
  )

  React.useEffect(() => {
    if (reduce) {
      setDisplay(formatValue(value, format, decimals))
      return
    }
    const controls = animate(mv, value, {
      duration,
      ease: [0.22, 0.61, 0.36, 1],
      onUpdate: (latest) => setDisplay(formatValue(latest, format, decimals)),
    })
    return () => controls.stop()
    // We intentionally re-run when `value` changes so the number re-animates
    // to the new target. format/decimals are stable in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, reduce])

  return (
    <span className={className} aria-label={String(value)}>
      {display}
    </span>
  )
}

function formatValue(
  n: number,
  format?: (n: number) => string,
  decimals?: number,
): string {
  if (format) return format(n)
  const d = decimals ?? 0
  const rounded = d > 0 ? n.toFixed(d) : Math.round(n).toString()
  // Add thousands separators for readability.
  const [intPart, fracPart] = rounded.split('.')
  const withCommas = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fracPart ? `${withCommas}.${fracPart}` : withCommas
}
