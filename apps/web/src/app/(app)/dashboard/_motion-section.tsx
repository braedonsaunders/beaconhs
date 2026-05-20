'use client'

import type { ReactNode } from 'react'
import { motion, type Variants } from 'framer-motion'

/**
 * Fade-and-slide wrapper used to stagger the dashboard's top-level sections on
 * mount. `index` controls the delay so a caller can write:
 *
 *   <MotionSection index={0}>{hero}</MotionSection>
 *   <MotionSection index={1}>{quickActions}</MotionSection>
 *   <MotionSection index={2}>{kpiStrip}</MotionSection>
 *
 * Keeps RSC contents on the server — only the wrapper is a client island.
 */
const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: 0.05 + i * 0.06,
      duration: 0.45,
      ease: [0.22, 1, 0.36, 1],
    },
  }),
}

export function MotionSection({
  index,
  children,
  className,
}: {
  index: number
  children: ReactNode
  className?: string
}) {
  return (
    <motion.section
      custom={index}
      initial="hidden"
      animate="visible"
      variants={sectionVariants}
      className={className}
    >
      {children}
    </motion.section>
  )
}

/**
 * Lift-on-hover wrapper for individual cards. Card-level hover effects look
 * nicer than CSS-only :hover because we can tween shadow + translate together.
 */
export function HoverLift({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <motion.div
      whileHover={{ y: -2, transition: { duration: 0.18 } }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
