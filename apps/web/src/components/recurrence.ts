import type { ComplianceAfterEvent, ComplianceRecurrence } from '@beaconhs/db/schema'

// Pure recurrence model + helpers shared by the RecurrencePicker (client), the
// obligation server actions, and the obligation edit page (server). Keep this
// module free of 'use client' — server components must be able to CALL these.

export type Frequency = 'day' | 'week' | 'month' | 'quarter' | 'year'

/** `after_event` is stored as a one_time recurrence carrying an `afterEvent` rule. */
export type RecurrenceKind = 'one_time' | 'after_event' | 'frequency' | 'cron'

export type RecurrenceValue = {
  kind: RecurrenceKind
  journalDays?: ComplianceRecurrence['journalDays']
  evidenceWindow?: 'calendar' | 'rolling'
  deadline?: ComplianceRecurrence['deadline']
  frequency?: Frequency
  /** Repeat every N cadence units (every 3 years). */
  interval?: number
  afterEvent?: ComplianceAfterEvent
  cron?: string
  quantity?: number
  compliantPercentage?: number
  dueOn?: string
  remindBeforeDays?: number
  dueOffsetMinutes?: number
  activeMonths?: { from: number; to: number }
  newEditionDueDays?: number
  reacknowledgeOnEdition?: boolean
}

export const FREQUENCIES: Array<{ value: Frequency; label: string; cron: string }> = [
  { value: 'day', label: 'Daily', cron: '0 8 * * *' },
  { value: 'week', label: 'Weekly', cron: '0 8 * * 1' },
  { value: 'month', label: 'Monthly', cron: '0 8 1 * *' },
  { value: 'quarter', label: 'Quarterly', cron: '0 8 1 */3 *' },
  { value: 'year', label: 'Yearly', cron: '0 8 1 1 *' },
]

const FREQUENCY_UNITS: Record<Frequency, [string, string]> = {
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
  quarter: ['quarter', 'quarters'],
  year: ['year', 'years'],
}

/** "Every 3 years" / "Yearly" — the cadence a frequency and interval describe. */
export function frequencyCadenceLabel(frequency: Frequency, interval = 1): string {
  if (interval <= 1) return FREQUENCIES.find((f) => f.value === frequency)?.label ?? frequency
  return `Every ${interval} ${FREQUENCY_UNITS[frequency][1]}`
}

/** The unit word after "Repeat every N". */
export function frequencyUnit(frequency: Frequency, interval = 1): string {
  return FREQUENCY_UNITS[frequency][interval === 1 ? 0 : 1]
}

export const AFTER_EVENT_OPTIONS: Array<{ value: ComplianceAfterEvent['event']; label: string }> = [
  { value: 'hire', label: 'Hire date' },
  { value: 'audience_join', label: 'Joining this requirement' },
  { value: 'job_title', label: 'Job title assigned' },
  { value: 'group_join', label: 'Added to a people group' },
]

/** "Within 30 days of hire date" — an after-event rule in words. */
export function afterEventLabel(afterEvent: ComplianceAfterEvent): string {
  const event =
    AFTER_EVENT_OPTIONS.find((option) => option.value === afterEvent.event)?.label ?? 'the event'
  return `Within ${afterEvent.days} ${afterEvent.days === 1 ? 'day' : 'days'} of ${event.toLowerCase()}`
}

export function frequencyToCron(f: Frequency): string {
  return FREQUENCIES.find((x) => x.value === f)?.cron ?? '0 8 * * 1'
}

export type RecurrenceFields = {
  /** Count submissions within calendar periods, with an explicit deadline. */
  calendar?: boolean
  /** Allow a one-time (single due date) cadence. */
  rolling?: boolean
  oneTime?: boolean
  /** Allow a recurring (frequency/cron) cadence. */
  recurring?: boolean
  /** Show quantity-per-period (inspection / journal). */
  quantity?: boolean
  /** Show the compliant-threshold % (inspection / journal). */
  threshold?: boolean
  /** Show the reminder lead-days (training). */
  remind?: boolean
  /** Show the due-offset minutes (inspection / form). */
  dueOffset?: boolean
}

/**
 * Inverse of the obligation action's `buildRecurrence`: map a stored
 * `ComplianceRecurrence` jsonb back to the form's `RecurrenceValue` so the edit
 * page can seed the picker. Stored `cron` recurrences surface as a frequency
 * when the cron matches a preset, otherwise as a cron override; `expiry`/`event`
 * kinds have no schedule knobs in the form and just get the defaults.
 */
export function recurrenceValueFromStored(rec: {
  kind: string
  journalDays?: ComplianceRecurrence['journalDays']
  evidenceWindow?: 'calendar' | 'rolling'
  deadline?: ComplianceRecurrence['deadline']
  frequency?: Frequency
  interval?: number
  afterEvent?: ComplianceAfterEvent
  cron?: string
  quantity?: number
  compliantPercentage?: number
  dueOn?: string
  remindBeforeDays?: number
  dueOffsetMinutes?: number
  activeMonths?: { from: number; to: number }
  newEditionDueDays?: number
  reacknowledgeOnEdition?: boolean
}): RecurrenceValue {
  if (rec.kind === 'event') {
    return {
      kind: 'frequency',
      frequency: 'year',
      reacknowledgeOnEdition: true,
      newEditionDueDays: rec.newEditionDueDays ?? 30,
    }
  }
  if (rec.kind === 'one_time' && rec.afterEvent) {
    return {
      kind: 'after_event',
      afterEvent: rec.afterEvent,
      remindBeforeDays: rec.remindBeforeDays ?? 7,
    }
  }
  if (rec.kind === 'one_time') {
    return { kind: 'one_time', dueOn: rec.dueOn, remindBeforeDays: rec.remindBeforeDays ?? 7 }
  }
  if (rec.kind === 'frequency' || rec.kind === 'cron') {
    const preset = rec.cron ? FREQUENCIES.find((f) => f.cron === rec.cron) : undefined
    const frequency = rec.frequency ?? preset?.value ?? 'week'
    const isPresetCron = Boolean(rec.cron) && rec.cron === frequencyToCron(frequency)
    return {
      kind: 'frequency',
      journalDays: rec.journalDays,
      evidenceWindow: rec.evidenceWindow ?? 'calendar',
      deadline: rec.deadline,
      frequency,
      interval: rec.interval,
      cron: isPresetCron ? undefined : rec.cron,
      quantity: rec.quantity ?? 1,
      compliantPercentage: rec.compliantPercentage ?? 100,
      remindBeforeDays: rec.remindBeforeDays ?? 7,
      dueOffsetMinutes: rec.dueOffsetMinutes,
      activeMonths: rec.activeMonths,
      newEditionDueDays: rec.newEditionDueDays,
      reacknowledgeOnEdition: rec.reacknowledgeOnEdition,
    }
  }
  // expiry / event — the form shows no schedule knobs for these kinds.
  return {
    kind: 'one_time',
    frequency: 'week',
    quantity: 1,
    compliantPercentage: 100,
    remindBeforeDays: rec.remindBeforeDays ?? 7,
  }
}

export function defaultCompletionDeadline(
  frequency: Frequency,
): NonNullable<ComplianceRecurrence['deadline']> {
  if (frequency === 'day') return { time: '23:59' }
  if (frequency === 'week') return { weekday: 7, time: '23:59' }
  if (frequency === 'month') return { day: 31, time: '23:59' }
  return { month: frequency === 'year' ? 12 : 3, day: 31, time: '23:59' }
}

export const CALENDAR_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const
export const CALENDAR_WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

/** One-line summary of a stored recurrence for lists and headers. */
export function describeRecurrence(
  rec: ComplianceRecurrence | null | undefined,
  translate: (value: string) => string = (value) => value,
): string {
  if (!rec) return '—'
  if (rec.journalDays)
    return translate(
      rec.journalDays === 'weekdays'
        ? 'One journal each weekday'
        : rec.journalDays === 'calendar'
          ? 'One journal every calendar day'
          : 'One journal each worked day (weekdays when unknown)',
    )
  if (rec.kind === 'frequency' && rec.deadline) {
    const deadline = rec.deadline
    const frequency = rec.frequency ?? 'year'
    const date =
      frequency === 'year'
        ? `${translate(CALENDAR_MONTHS[(deadline.month ?? 1) - 1] ?? 'January')} ${deadline.day}`
        : frequency === 'quarter'
          ? `${translate('Month of quarter')} ${deadline.month}, ${translate('Day of month')} ${deadline.day}`
          : frequency === 'month'
            ? `${translate('Day of month')} ${deadline.day}`
            : frequency === 'week'
              ? translate(CALENDAR_WEEKDAYS[(deadline.weekday ?? 1) - 1] ?? 'Monday')
              : ''
    return `${translate(frequencyCadenceLabel(frequency, rec.interval))} · ${translate('Due by')} ${date} ${deadline.time}`
  }
  if (rec.kind === 'frequency' && rec.evidenceWindow === 'rolling') {
    const labels = {
      day: 'Rolling 1 day',
      week: 'Rolling 1 week',
      month: 'Rolling 1 month',
      quarter: 'Rolling 3 months',
      year: 'Rolling 12 months',
    }
    const frequency = rec.frequency ?? 'year'
    if ((rec.interval ?? 1) > 1)
      return `${translate('Rolling')} ${rec.interval} ${translate(frequencyUnit(frequency, rec.interval))}`
    return translate(labels[frequency])
  }
  if (rec.kind === 'frequency') {
    const frequency = rec.frequency ?? 'week'
    const every =
      (rec.interval ?? 1) > 1
        ? `${rec.interval} ${frequencyUnit(frequency, rec.interval)}`
        : frequency
    return `${rec.quantity ?? 1}/${translate(every)}`
  }
  if (rec.kind === 'cron') return rec.cron ? `cron ${rec.cron}` : '—'
  if (rec.kind === 'one_time' && rec.afterEvent) return translate(afterEventLabel(rec.afterEvent))
  if (rec.kind === 'one_time')
    return rec.dueOn ? `${translate('Due')} ${rec.dueOn}` : translate('One-time')
  if (rec.kind === 'event')
    return `${translate('Each new edition')} · ${rec.newEditionDueDays ?? 30} ${translate('days')}`
  if (rec.kind === 'expiry') return translate('Continuous')
  return rec.kind
}
