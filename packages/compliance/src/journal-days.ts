import type { ComplianceRecurrence } from '@beaconhs/db/schema'

/** Dates stay date-only; never let the host's timezone shift an employee's day. */
function journalCalendarDates(start: string, end: string): string[] {
  const dates: string[] = []
  const cursor = new Date(`${start}T00:00:00Z`)
  for (let i = 0; i < 370 && cursor.toISOString().slice(0, 10) <= end; i++) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

export function journalDayProgress(args: {
  mode: NonNullable<ComplianceRecurrence['journalDays']>
  start: string
  end: string
  today: string
  completedDates: readonly string[]
  workDays: ReadonlyMap<string, boolean>
}) {
  const completed = new Set(args.completedDates.filter((d) => d <= args.today))
  let fallbackDays = 0
  const required = journalCalendarDates(args.start, args.end).filter((date) => {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay()
    const weekday = day > 0 && day < 6
    if (args.mode === 'calendar') return true
    if (args.mode === 'weekdays') return weekday
    const worked = args.workDays.get(date)
    if (worked !== undefined) return worked
    // Fail safe when a provider is missing/late: never infer leave from absent data.
    if (date <= args.today) fallbackDays++
    return weekday
  })
  const submitted = required.filter((date) => completed.has(date))
  const missed = required.filter((date) => date < args.today && !completed.has(date))
  const dueOn =
    missed[0] ??
    required.find((date) => date >= args.today && !completed.has(date)) ??
    required.at(-1) ??
    null
  return {
    count: submitted.length,
    expected: required.length,
    percent: required.length ? Math.round((submitted.length / required.length) * 100) : 100,
    status: missed.length
      ? ('overdue' as const)
      : submitted.length === required.length
        ? ('completed' as const)
        : submitted.length
          ? ('in_progress' as const)
          : ('pending' as const),
    dueOn,
    completedOn: submitted.at(-1) ?? null,
    fallbackDays,
  }
}
