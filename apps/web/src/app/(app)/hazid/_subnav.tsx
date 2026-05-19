import Link from 'next/link'
import { cn } from '@beaconhs/ui'

// Horizontal pill nav strip shown at the top of every /hazid/* page.
// Mirrors the legacy "Hazard ID" mega-menu (Assessments | Hazards | Tasks | Types | Signed Reports).
const ITEMS: { href: string; label: string; pattern: RegExp }[] = [
  { href: '/hazid', label: 'Assessments', pattern: /^\/hazid(?!\/(?:hazards|tasks|types|reports))/ },
  { href: '/hazid/hazards', label: 'Hazards', pattern: /^\/hazid\/hazards(?!\/(?:types|sets))/ },
  { href: '/hazid/hazards/types', label: 'Hazard types', pattern: /^\/hazid\/hazards\/types/ },
  { href: '/hazid/hazards/sets', label: 'Hazard sets', pattern: /^\/hazid\/hazards\/sets/ },
  { href: '/hazid/tasks', label: 'Tasks', pattern: /^\/hazid\/tasks/ },
  { href: '/hazid/types', label: 'Assessment types', pattern: /^\/hazid\/types/ },
  { href: '/hazid/reports/signed', label: 'Signed reports', pattern: /^\/hazid\/reports\/signed/ },
]

export function HazidSubNav({ pathname }: { pathname: string }) {
  return (
    <nav className="flex flex-wrap items-center gap-1">
      {ITEMS.map((item) => {
        const isActive = item.pattern.test(pathname)
        return (
          <Link
            key={item.href}
            href={item.href as any}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              isActive
                ? 'border-teal-600 bg-teal-50 text-teal-800'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
