import { cn } from '@beaconhs/ui'

const LABELS: Record<number, { label: string; tone: string }> = {
  1: {
    label: 'No first aid / no damage',
    tone: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  },
  2: { label: 'First aid / < $1k', tone: 'bg-lime-100 text-lime-900 border-lime-300' },
  3: { label: 'Medical aid / < $5k', tone: 'bg-amber-100 text-amber-900 border-amber-300' },
  4: { label: 'Critical / < $25k', tone: 'bg-orange-100 text-orange-900 border-orange-300' },
  5: { label: 'Fatality / > $25k', tone: 'bg-red-100 text-red-900 border-red-300' },
}

/**
 * Read-only display of the 5-level severity matrix (matches legacy Incident
 * "Key Metrics" actual + potential severity radio buttons).
 */
export function SeverityRating({
  value,
  label,
}: {
  value: number | null | undefined
  label: string
}) {
  return (
    <div>
      <div className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value === n
          const meta = LABELS[n]!
          return (
            <span
              key={n}
              title={`${n} — ${meta.label}`}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded border text-xs font-semibold',
                active
                  ? meta.tone
                  : 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500',
              )}
            >
              {n}
            </span>
          )
        })}
        {value ? (
          <span className="ml-2 text-xs text-slate-600 dark:text-slate-300">
            {LABELS[value]?.label}
          </span>
        ) : (
          <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">not rated</span>
        )}
      </div>
    </div>
  )
}
