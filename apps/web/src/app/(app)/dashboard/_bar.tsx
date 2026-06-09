'use client'

import { motion } from 'framer-motion'

/**
 * Animated horizontal bar used by the "Top sites by incidents" widget. The
 * bar's width animates from 0% to its target % once mounted, with a small
 * per-row delay so the rows feel like they unspool.
 */
export function AnimatedBar({
  pct,
  delay = 0,
  tone = 'rose',
}: {
  /** Percentage (0–100). */
  pct: number
  /** Stagger offset in seconds. */
  delay?: number
  tone?: 'rose' | 'amber' | 'teal'
}) {
  const fill =
    tone === 'amber'
      ? 'from-amber-500 to-amber-300'
      : tone === 'teal'
        ? 'from-teal-600 to-teal-400'
        : 'from-rose-600 to-rose-400'
  const clamped = Math.max(2, Math.min(100, pct))
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${clamped}%` }}
        transition={{
          duration: 0.9,
          delay,
          ease: [0.22, 1, 0.36, 1],
        }}
        className={`h-full rounded-full bg-gradient-to-r ${fill}`}
      />
    </div>
  )
}
