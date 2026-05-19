import Link from 'next/link'
import { cn } from '@beaconhs/ui'

// Routes in the order they appear in the top training nav.
// Keep this list in sync with the new training expansion (Records / Courses /
// Classes / Assessments / Assignments / Matrix / Transcripts / Reports / Skills /
// Authorities).
const TABS = [
  { href: '/training', label: 'Records' },
  { href: '/training/courses', label: 'Courses' },
  { href: '/training/classes', label: 'Classes' },
  { href: '/training/assessments', label: 'Assessments' },
  { href: '/training/assignments', label: 'Assignments' },
  { href: '/training/matrix', label: 'Matrix' },
  { href: '/training/transcripts', label: 'Transcripts' },
  { href: '/training/reports', label: 'Reports' },
  { href: '/training/skills', label: 'Skill types' },
  { href: '/training/authorities', label: 'Authorities' },
] as const

export type TrainingTab =
  | 'records'
  | 'courses'
  | 'classes'
  | 'assessments'
  | 'assessment-types'
  | 'assignments'
  | 'matrix'
  | 'transcripts'
  | 'reports'
  | 'skills'
  | 'authorities'

const TAB_TO_HREF: Record<TrainingTab, string> = {
  records: '/training',
  courses: '/training/courses',
  classes: '/training/classes',
  assessments: '/training/assessments',
  'assessment-types': '/training/assessments/types',
  assignments: '/training/assignments',
  matrix: '/training/matrix',
  transcripts: '/training/transcripts',
  reports: '/training/reports',
  skills: '/training/skills',
  authorities: '/training/authorities',
}

/**
 * The strip of pill links that sits above every page under /training.
 * Pass the `active` prop so the matching tab gets the teal highlight.
 *
 * For deep routes that aren't in the strip (e.g. /training/assessments/types),
 * pick the closest parent tab — `assessments` for that example.
 */
export function TrainingSubNav({ active }: { active: TrainingTab }) {
  const activeHref = TAB_TO_HREF[active]
  return (
    <nav className="flex flex-wrap items-center gap-2">
      {TABS.map((t) => {
        const isActive = t.href === activeHref
        return (
          <Link
            key={t.href}
            href={t.href as any}
            className={cn(
              'rounded-full border px-3 py-1 text-xs',
              isActive
                ? 'border-teal-500 bg-teal-50 font-medium text-teal-700'
                : 'border-slate-200 text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700',
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
