// Plain-language summaries of brief schedules and windows for lists and emails.

import type { BriefWindowSpec } from '@beaconhs/db/schema'

export const BRIEF_RUN_TRIGGER_LABEL = {
  scheduled: 'Scheduled',
  manual: 'Run now',
  preview: 'Preview',
  api: 'API',
} as const

export const BRIEF_RUN_STATUS_LABEL = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
} as const

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function windowSummary(window: BriefWindowSpec): string {
  switch (window.mode) {
    case 'previous_day':
      return 'The previous day'
    case 'previous_business_day':
      return 'The previous business day (Monday covers the weekend)'
    case 'last_n_days':
      return `The last ${window.days} days`
    case 'since_last_run':
      return 'Everything since the last brief'
  }
}

export function cadenceSummary(schedule: {
  cadence: 'daily' | 'weekly' | 'monthly'
  repeatEvery: number
  weekdaysOnly: boolean
  dayOfWeek: number | null
  dayOfMonth: number | null
  hour: number
  minute: number
  timezone: string
}): string {
  const time = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`
  const every = schedule.repeatEvery > 1 ? `every ${schedule.repeatEvery} ` : ''
  switch (schedule.cadence) {
    case 'daily':
      return `${schedule.weekdaysOnly ? 'Weekdays' : every ? `Every ${schedule.repeatEvery} days` : 'Daily'} at ${time} (${schedule.timezone})`
    case 'weekly':
      return `${every ? `Every ${schedule.repeatEvery} weeks on` : 'Every'} ${DAYS[schedule.dayOfWeek ?? 1]} at ${time} (${schedule.timezone})`
    case 'monthly':
      return `${every ? `Every ${schedule.repeatEvery} months` : 'Monthly'} on day ${schedule.dayOfMonth ?? 1} at ${time} (${schedule.timezone})`
  }
}
