'use client'

import Link from 'next/link'
import {
  AlertTriangle,
  ClipboardCheck,
  ClipboardList,
  FileText,
  HardHat,
  ListChecks,
  Plus,
  type LucideIcon,
} from 'lucide-react'
import { motion } from 'framer-motion'

/**
 * A horizontal pill rail of common "start something" actions. We expose them
 * here so the dashboard isn't just a read-only display — power users can hit
 * "Report incident" or "Log toolbox talk" in one click from the landing page.
 *
 * Each pill has its own accent color so they don't blur together visually:
 * red for the safety-critical "Report incident", amber for hazid, etc.
 */
type Tone = 'rose' | 'amber' | 'teal' | 'sky' | 'violet' | 'slate'

type Action = {
  href: string
  label: string
  icon: LucideIcon
  tone: Tone
}

const ACTIONS: Action[] = [
  { href: '/incidents/new', label: 'Report incident', icon: AlertTriangle, tone: 'rose' },
  {
    href: '/hazard-assessments/new',
    label: 'Start hazard assessment',
    icon: HardHat,
    tone: 'amber',
  },
  {
    href: '/forms/by-key/toolbox-talk/fill',
    label: 'Log toolbox talk',
    icon: ClipboardList,
    tone: 'sky',
  },
  { href: '/corrective-actions/new', label: 'New CA', icon: ListChecks, tone: 'teal' },
  {
    href: '/equipment/check-out',
    label: 'Check out equipment',
    icon: ClipboardCheck,
    tone: 'violet',
  },
  { href: '/reports', label: 'Run report', icon: FileText, tone: 'slate' },
]

const toneClasses: Record<Tone, { ring: string; bg: string; chip: string; icon: string }> = {
  rose: {
    ring: 'hover:border-rose-300 hover:shadow-rose-100/60',
    bg: 'group-hover:bg-rose-50/80',
    chip: 'bg-rose-100 text-rose-700 group-hover:bg-rose-600 group-hover:text-white',
    icon: 'text-rose-600',
  },
  amber: {
    ring: 'hover:border-amber-300 hover:shadow-amber-100/60',
    bg: 'group-hover:bg-amber-50/80',
    chip: 'bg-amber-100 text-amber-700 group-hover:bg-amber-500 group-hover:text-white',
    icon: 'text-amber-600',
  },
  teal: {
    ring: 'hover:border-teal-300 hover:shadow-teal-100/60',
    bg: 'group-hover:bg-teal-50/80',
    chip: 'bg-teal-100 text-teal-700 group-hover:bg-teal-700 group-hover:text-white',
    icon: 'text-teal-700',
  },
  sky: {
    ring: 'hover:border-sky-300 hover:shadow-sky-100/60',
    bg: 'group-hover:bg-sky-50/80',
    chip: 'bg-sky-100 text-sky-700 group-hover:bg-sky-600 group-hover:text-white',
    icon: 'text-sky-700',
  },
  violet: {
    ring: 'hover:border-violet-300 hover:shadow-violet-100/60',
    bg: 'group-hover:bg-violet-50/80',
    chip: 'bg-violet-100 text-violet-700 group-hover:bg-violet-600 group-hover:text-white',
    icon: 'text-violet-700',
  },
  slate: {
    ring: 'hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-slate-200/60',
    bg: 'group-hover:bg-slate-50/80',
    chip: 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 group-hover:bg-slate-700 group-hover:text-white',
    icon: 'text-slate-600 dark:text-slate-300',
  },
}

export function QuickActions() {
  return (
    <div className="flex flex-wrap gap-2.5">
      {ACTIONS.map((a, i) => {
        const t = toneClasses[a.tone]
        const Icon = a.icon
        return (
          <motion.div
            key={a.href}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: 0.05 + i * 0.04,
              duration: 0.35,
              ease: [0.22, 1, 0.36, 1],
            }}
            whileHover={{ y: -2 }}
          >
            <Link
              href={a.href as any}
              className={`group inline-flex items-center gap-2.5 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-800 shadow-sm transition-all dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 ${t.ring} ${t.bg}`}
            >
              <span
                className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs transition-colors ${t.chip}`}
              >
                <Icon size={14} />
              </span>
              <span className="flex items-center gap-1.5">
                {a.label}
                <Plus
                  size={12}
                  className={`opacity-0 transition-opacity group-hover:opacity-100 ${t.icon}`}
                />
              </span>
            </Link>
          </motion.div>
        )
      })}
    </div>
  )
}
