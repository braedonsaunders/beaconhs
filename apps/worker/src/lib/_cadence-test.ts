import { computeNextRunAt } from './report-scheduler'

const now = new Date('2026-05-18T15:00:00Z') // Mon 11am EDT

console.log('Daily 07:00 America/Toronto (next from Mon 11am EDT):')
console.log(
  ' →',
  computeNextRunAt(
    { cadence: 'daily', hour: 7, minute: 0, timezone: 'America/Toronto' },
    now,
  ).toISOString(),
)

console.log('Weekly Mon 07:00 America/Toronto (next from Mon 11am EDT):')
console.log(
  ' →',
  computeNextRunAt(
    { cadence: 'weekly', dayOfWeek: 1, hour: 7, minute: 0, timezone: 'America/Toronto' },
    now,
  ).toISOString(),
)

console.log('Monthly day 1 07:00 America/Toronto (next from Mon May 18 11am EDT):')
console.log(
  ' →',
  computeNextRunAt(
    { cadence: 'monthly', dayOfMonth: 1, hour: 7, minute: 0, timezone: 'America/Toronto' },
    now,
  ).toISOString(),
)

console.log('Weekly Fri 14:30 UTC:')
console.log(
  ' →',
  computeNextRunAt(
    { cadence: 'weekly', dayOfWeek: 5, hour: 14, minute: 30, timezone: 'UTC' },
    now,
  ).toISOString(),
)

console.log('Daily 11:30 America/Toronto from 11:00 EDT today (should be 30 min from now):')
console.log(
  ' →',
  computeNextRunAt(
    { cadence: 'daily', hour: 11, minute: 30, timezone: 'America/Toronto' },
    now,
  ).toISOString(),
)
