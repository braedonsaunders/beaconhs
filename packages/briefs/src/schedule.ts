// Brief schedule timing: AppKit's cadence math (shared with scheduled reports)
// plus the weekdays-only rule for daily briefs.

import { computeNextRunAt } from '@beaconhs/reports'
import { localDate, weekday } from './window'

export type BriefCadenceInput = {
  cadence: 'daily' | 'weekly' | 'monthly'
  repeatEvery: number
  dayOfWeek: number | null
  dayOfMonth: number | null
  weekOfMonth: number | null
  hour: number
  minute: number
  timezone: string
  startsOn: string | null
  endsOn: string | null
  weekdaysOnly: boolean
}

/** The next occurrence strictly after `from`, skipping weekends when asked. */
export function nextBriefRunAt(input: BriefCadenceInput, from: Date = new Date()): Date | null {
  let next = computeNextRunAt(input, from)
  if (!input.weekdaysOnly || input.cadence !== 'daily') return next
  for (let guard = 0; next && guard < 7; guard++) {
    const day = weekday(localDate(next, input.timezone))
    if (day !== 0 && day !== 6) return next
    next = computeNextRunAt(input, next)
  }
  return next
}
