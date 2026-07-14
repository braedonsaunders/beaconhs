import cronParser from 'cron-parser'
import type { ComplianceRecurrence } from '@beaconhs/db/schema'

const { parseExpression } = cronParser

export type ComplianceClock = {
  now: Date
  timezone: string
}

export type Frequency = NonNullable<ComplianceRecurrence['frequency']>

export type FrequencyWindow = {
  periodStart: string
  periodEnd: string
  periodStartAt: Date
  periodEndAt: Date
  evidenceStartAt: Date
  scheduledAt: Date
  dueAt: Date
  dueOn: string
  nextDueAt: Date
}

export type CronWindow = {
  started: boolean
  periodStart: string
  periodEnd: string
  evidenceStartAt: Date
  periodEndAt: Date
  scheduledAt: Date
  dueAt: Date
  dueOn: string
  nextScheduledAt: Date
  nextDueAt: Date
}

export type FrequencyProgress = {
  status: 'completed' | 'overdue' | 'pending' | 'in_progress'
  required: number
  percent: number
}

const DEFAULT_CRON: Record<Frequency, string> = {
  day: '0 8 * * *',
  week: '0 8 * * 1',
  month: '0 8 1 * *',
  quarter: '0 8 1 */3 *',
  year: '0 8 1 1 *',
}

type CalendarDate = { year: number; month: number; day: number }
type ZonedDateTime = CalendarDate & { hour: number; minute: number; second: number }

const dateFormatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timezone: string): Intl.DateTimeFormat {
  const cached = dateFormatters.get(timezone)
  if (cached) return cached
  const value = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  // Force Intl to validate the IANA identifier now, instead of failing in the
  // middle of a tenant scan after status rows have already been materialized.
  value.format(new Date(0))
  dateFormatters.set(timezone, value)
  return value
}

function zonedParts(value: Date, timezone: string): ZonedDateTime {
  const parts = Object.fromEntries(
    formatter(timezone)
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour!,
    minute: parts.minute!,
    second: parts.second!,
  }
}

function calendarDate(value: Date, timezone: string): CalendarDate {
  const { year, month, day } = zonedParts(value, timezone)
  return { year, month, day }
}

export function complianceDate(clock: ComplianceClock): string {
  return dateKey(calendarDate(clock.now, clock.timezone))
}

function dateKey(value: CalendarDate): string {
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`
}

function fromCalendar(value: CalendarDate): Date {
  return new Date(Date.UTC(value.year, value.month - 1, value.day))
}

function toCalendar(value: Date): CalendarDate {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  }
}

function addCalendarDays(value: CalendarDate, amount: number): CalendarDate {
  const date = fromCalendar(value)
  date.setUTCDate(date.getUTCDate() + amount)
  return toCalendar(date)
}

function addCalendarMonths(value: CalendarDate, amount: number): CalendarDate {
  const date = new Date(Date.UTC(value.year, value.month - 1 + amount, 1))
  return toCalendar(date)
}

function zonedMidnight(value: CalendarDate, timezone: string): Date {
  const target = Date.UTC(value.year, value.month - 1, value.day, 0, 0, 0)
  let candidate = target
  // Convert a wall-clock time to an instant without depending on the host
  // process timezone. Iterating handles daylight-saving offset changes.
  for (let i = 0; i < 4; i++) {
    const actual = zonedParts(new Date(candidate), timezone)
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    )
    const adjustment = target - actualAsUtc
    candidate += adjustment
    if (adjustment === 0) break
  }
  return new Date(candidate)
}

function periodStartFor(value: CalendarDate, frequency: Frequency): CalendarDate {
  if (frequency === 'day') return value
  if (frequency === 'week') {
    const day = fromCalendar(value).getUTCDay()
    return addCalendarDays(value, -(day === 0 ? 6 : day - 1))
  }
  if (frequency === 'month') return { ...value, day: 1 }
  if (frequency === 'quarter') {
    return { year: value.year, month: Math.floor((value.month - 1) / 3) * 3 + 1, day: 1 }
  }
  return { year: value.year, month: 1, day: 1 }
}

function shiftPeriod(value: CalendarDate, frequency: Frequency, amount: number): CalendarDate {
  if (frequency === 'day') return addCalendarDays(value, amount)
  if (frequency === 'week') return addCalendarDays(value, amount * 7)
  if (frequency === 'month') return addCalendarMonths(value, amount)
  if (frequency === 'quarter') return addCalendarMonths(value, amount * 3)
  return { year: value.year + amount, month: 1, day: 1 }
}

function occurrenceForPeriod(
  expression: string,
  periodStartAt: Date,
  periodEndAt: Date,
  timezone: string,
): Date {
  if (expression.trim().split(/\s+/).length !== 5) {
    throw new Error('The cron schedule must contain exactly five fields')
  }
  const iterator = parseExpression(expression, {
    currentDate: new Date(periodStartAt.getTime() - 1),
    tz: timezone,
  })
  const first = iterator.next().toDate()
  if (first.getTime() >= periodEndAt.getTime()) {
    throw new Error('The cron schedule does not fire in every selected cadence period')
  }
  const second = iterator.next().toDate()
  if (second.getTime() < periodEndAt.getTime()) {
    throw new Error('The cron schedule fires more than once in the selected cadence period')
  }
  return first
}

function offsetMilliseconds(recurrence: ComplianceRecurrence): number {
  const minutes = recurrence.dueOffsetMinutes ?? 0
  const days = recurrence.dueOffsetDays ?? 0
  if (!Number.isSafeInteger(minutes) || minutes < 0) {
    throw new Error('Due offset minutes must be a non-negative whole number')
  }
  if (!Number.isSafeInteger(days) || days < 0) {
    throw new Error('Due offset days must be a non-negative whole number')
  }
  return (minutes + days * 24 * 60) * 60_000
}

function cronExpression(recurrence: ComplianceRecurrence): string {
  const expression = recurrence.cron?.trim()
  if (!expression) throw new Error('A cron obligation must declare its schedule')
  if (expression.split(/\s+/).length !== 5) {
    throw new Error('The cron schedule must contain exactly five fields')
  }
  return expression
}

function nextCronOccurrence(expression: string, after: Date, timezone: string): Date {
  return parseExpression(expression, { currentDate: after, tz: timezone }).next().toDate()
}

function previousCronOccurrence(expression: string, at: Date, timezone: string): Date {
  // prev() is exclusive. Moving one millisecond forward includes an occurrence
  // exactly on the current minute boundary.
  return parseExpression(expression, {
    currentDate: new Date(at.getTime() + 1),
    tz: timezone,
  })
    .prev()
    .toDate()
}

/**
 * Resolve the active interval for an arbitrary five-field cron obligation.
 *
 * Unlike a frequency cadence, a cron may fire on weekdays, several times a
 * day, or at irregular month boundaries. The period is therefore the exact
 * interval from one fire to the next; no weekly fallback is inferred. An
 * obligation created between fires starts at the next fire, so historical
 * responses cannot satisfy a task that did not yet exist.
 */
export function resolveCronWindow(
  recurrence: ComplianceRecurrence,
  clock: ComplianceClock,
  activeFrom: Date,
): CronWindow {
  if (!(activeFrom instanceof Date) || Number.isNaN(activeFrom.getTime())) {
    throw new Error('The obligation activation time is invalid')
  }
  const expression = cronExpression(recurrence)
  // Starting one millisecond before activeFrom includes an occurrence exactly
  // at activation while excluding any earlier schedule history.
  const firstEligible = nextCronOccurrence(
    expression,
    new Date(activeFrom.getTime() - 1),
    clock.timezone,
  )
  const latest = previousCronOccurrence(expression, clock.now, clock.timezone)
  const scheduledAt = latest.getTime() >= firstEligible.getTime() ? latest : firstEligible
  const started = scheduledAt.getTime() <= clock.now.getTime()
  const nextScheduledAt = nextCronOccurrence(expression, scheduledAt, clock.timezone)
  const offset = offsetMilliseconds(recurrence)
  const interval = nextScheduledAt.getTime() - scheduledAt.getTime()
  if (offset > interval) {
    throw new Error('The due offset must not extend beyond the next scheduled occurrence')
  }
  const dueAt = new Date(scheduledAt.getTime() + offset)
  const nextDueAt = new Date(nextScheduledAt.getTime() + offset)
  return {
    started,
    periodStart: dateKey(calendarDate(scheduledAt, clock.timezone)),
    periodEnd: dateKey(calendarDate(new Date(nextScheduledAt.getTime() - 1), clock.timezone)),
    evidenceStartAt: new Date(Math.max(scheduledAt.getTime(), activeFrom.getTime())),
    periodEndAt: nextScheduledAt,
    scheduledAt,
    dueAt,
    dueOn: dateKey(calendarDate(dueAt, clock.timezone)),
    nextScheduledAt,
    nextDueAt: dueAt.getTime() > clock.now.getTime() ? dueAt : nextDueAt,
  }
}

function periodWindow(
  start: CalendarDate,
  frequency: Frequency,
  recurrence: ComplianceRecurrence,
  timezone: string,
) {
  const nextStart = shiftPeriod(start, frequency, 1)
  const periodStartAt = zonedMidnight(start, timezone)
  const periodEndAt = zonedMidnight(nextStart, timezone)
  const expression = recurrence.cron?.trim() || DEFAULT_CRON[frequency]
  const scheduledAt = occurrenceForPeriod(expression, periodStartAt, periodEndAt, timezone)
  const dueAt = new Date(scheduledAt.getTime() + offsetMilliseconds(recurrence))
  return {
    start,
    nextStart,
    periodStartAt,
    periodEndAt,
    scheduledAt,
    dueAt,
  }
}

/**
 * Resolve the one active frequency period for an obligation.
 *
 * A period becomes active at its scheduled cron occurrence, not at midnight.
 * Before that occurrence, the prior period remains visible (and can remain
 * overdue). This avoids a daily/weekly obligation silently clearing at the
 * calendar boundary before the next scheduled fire. Obligations created after
 * a period fired begin at the next occurrence, so they never start overdue.
 */
export function resolveFrequencyWindow(
  recurrence: ComplianceRecurrence,
  clock: ComplianceClock,
  activeFrom: Date,
): FrequencyWindow {
  const frequency = recurrence.frequency
  if (!frequency) throw new Error('A frequency obligation must declare its cadence')
  if (!(activeFrom instanceof Date) || Number.isNaN(activeFrom.getTime())) {
    throw new Error('The obligation activation time is invalid')
  }
  const currentStart = periodStartFor(calendarDate(clock.now, clock.timezone), frequency)
  const current = periodWindow(currentStart, frequency, recurrence, clock.timezone)
  const previous = periodWindow(
    shiftPeriod(currentStart, frequency, -1),
    frequency,
    recurrence,
    clock.timezone,
  )
  const following = periodWindow(
    shiftPeriod(currentStart, frequency, 1),
    frequency,
    recurrence,
    clock.timezone,
  )

  const eligible = [previous, current, following].filter(
    (window) => window.scheduledAt.getTime() >= activeFrom.getTime(),
  )
  const started = eligible.filter((window) => window.scheduledAt.getTime() <= clock.now.getTime())
  const selected = started.at(-1) ?? eligible[0]
  if (!selected) throw new Error('The obligation has no valid scheduled period')

  const nextStart = shiftPeriod(selected.start, frequency, 1)
  const next = periodWindow(nextStart, frequency, recurrence, clock.timezone)
  const interval = next.scheduledAt.getTime() - selected.scheduledAt.getTime()
  if (selected.dueAt.getTime() - selected.scheduledAt.getTime() > interval) {
    throw new Error('The due offset must not extend beyond the next scheduled occurrence')
  }

  const evidenceStartAt = new Date(Math.max(selected.periodStartAt.getTime(), activeFrom.getTime()))
  const nextDueAt = selected.dueAt.getTime() > clock.now.getTime() ? selected.dueAt : next.dueAt
  return {
    periodStart: dateKey(selected.start),
    periodEnd: dateKey(addCalendarDays(selected.nextStart, -1)),
    periodStartAt: selected.periodStartAt,
    periodEndAt: selected.periodEndAt,
    evidenceStartAt,
    scheduledAt: selected.scheduledAt,
    dueAt: selected.dueAt,
    dueOn: dateKey(calendarDate(selected.dueAt, clock.timezone)),
    nextDueAt,
  }
}

export function frequencyProgress(
  count: number,
  quantity: number,
  compliantPercentage: number,
  dueAt: Date,
  now: Date,
): FrequencyProgress {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error('Quantity per period must be a positive whole number')
  }
  if (
    !Number.isFinite(compliantPercentage) ||
    compliantPercentage < 0 ||
    compliantPercentage > 100
  ) {
    throw new Error('Compliant percentage must be between 0 and 100')
  }
  const safeCount = Math.max(0, Math.trunc(count))
  const required = Math.ceil((quantity * compliantPercentage) / 100)
  const percent = Math.min(100, Math.round((safeCount / quantity) * 100))
  const status =
    safeCount >= required
      ? 'completed'
      : now.getTime() > dueAt.getTime()
        ? 'overdue'
        : safeCount > 0
          ? 'in_progress'
          : 'pending'
  return { status, required, percent }
}

/** Validate cron/cadence/offset compatibility without writing anything. */
export function validateFrequencyRecurrence(
  recurrence: ComplianceRecurrence,
  clock: ComplianceClock,
): void {
  resolveFrequencyWindow(recurrence, clock, clock.now)
}

/** Validate an arbitrary cron and its due offset across upcoming intervals. */
export function validateCronRecurrence(
  recurrence: ComplianceRecurrence,
  clock: ComplianceClock,
): void {
  const expression = cronExpression(recurrence)
  const offset = offsetMilliseconds(recurrence)
  let occurrence = nextCronOccurrence(expression, new Date(clock.now.getTime() - 1), clock.timezone)
  // Weekday and month schedules have unequal intervals. Sampling the next 64
  // fires catches their shortest interval instead of validating only today's
  // (potentially long weekend/month-end) gap.
  for (let index = 0; index < 64; index += 1) {
    const next = nextCronOccurrence(expression, occurrence, clock.timezone)
    if (offset > next.getTime() - occurrence.getTime()) {
      throw new Error('The due offset must not extend beyond the next scheduled occurrence')
    }
    occurrence = next
  }
}
