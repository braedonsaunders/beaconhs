// Shared parser/validator for the schedule form's field contract. The create
// and update server actions post the exact same fields; parsing them in one
// place keeps validation identical (hour/minute/day ranges, timezone,
// recipients, filters JSON) so the two paths cannot drift.

import {
  assertBoundedReportFilters,
  assertReportRecipientLimit,
  normalizeReportRecipientEmails,
  normalizeReportRecipientUserIds,
  REPORT_SCHEDULE_LIMITS,
} from '@beaconhs/reports/schedule-policy'

type ScheduleCadence = 'daily' | 'weekly' | 'monthly'

type ParsedScheduleForm = {
  name: string
  cadence: ScheduleCadence
  repeatEvery: number
  dayOfWeek: number | null
  dayOfMonth: number | null
  weekOfMonth: number | null
  hour: number
  minute: number
  timezone: string
  startsOn: string | null
  endsOn: string | null
  recipientUserIds: string[]
  recipientEmails: string[]
  filters: Record<string, unknown>
  emailSubject: string | null
  emailMessage: string | null
}

const CADENCES: readonly ScheduleCadence[] = ['daily', 'weekly', 'monthly']

function parseIntField(raw: FormDataEntryValue | null, fallback: number): number {
  const s = String(raw ?? '').trim()
  if (s === '') return fallback
  if (!/^-?\d+$/.test(s)) return Number.NaN
  const value = Number(s)
  return Number.isSafeInteger(value) ? value : Number.NaN
}

export function parseScheduleForm(formData: FormData): ParsedScheduleForm {
  const name = String(formData.get('name') ?? '').trim()
  const cadence = String(formData.get('cadence') ?? '') as ScheduleCadence
  const repeatEvery = parseIntField(formData.get('repeatEvery'), 1)
  const hour = parseIntField(formData.get('hour'), 7)
  const minute = parseIntField(formData.get('minute'), 0)
  const timezone = String(formData.get('timezone') ?? '').trim() || 'America/Toronto'

  if (!name) throw new Error('Name is required')
  if (name.length > REPORT_SCHEDULE_LIMITS.nameChars) throw new Error('Name is too long')
  if (!CADENCES.includes(cadence)) throw new Error('Invalid cadence')
  if (!Number.isInteger(repeatEvery) || repeatEvery < 1 || repeatEvery > 999) {
    throw new Error('Repeat interval must be a whole number between 1 and 999')
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('Hour must be a whole number between 0 and 23')
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error('Minute must be a whole number between 0 and 59')
  }

  const monthlyMode = String(formData.get('monthlyMode') ?? 'day')
  if (cadence === 'monthly' && !['day', 'weekday'].includes(monthlyMode)) {
    throw new Error('Invalid monthly schedule mode')
  }
  const dayOfWeek =
    cadence === 'weekly' || (cadence === 'monthly' && monthlyMode === 'weekday')
      ? parseIntField(formData.get('dayOfWeek'), 1)
      : null
  const dayOfMonth =
    cadence === 'monthly' && monthlyMode === 'day'
      ? parseIntField(formData.get('dayOfMonth'), 1)
      : null
  const weekOfMonth =
    cadence === 'monthly' && monthlyMode === 'weekday'
      ? parseIntField(formData.get('weekOfMonth'), 1)
      : null
  if (dayOfWeek !== null && (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)) {
    throw new Error('Day of week must be between 0 (Sunday) and 6 (Saturday)')
  }
  if (
    cadence === 'monthly' &&
    monthlyMode === 'day' &&
    (dayOfMonth === null || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)
  ) {
    throw new Error('Day of month must be between 1 and 31')
  }
  if (
    weekOfMonth !== null &&
    (!Number.isInteger(weekOfMonth) || weekOfMonth < 1 || weekOfMonth > 5)
  ) {
    throw new Error('Week of month must be first, second, third, fourth, or last')
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/
  const parseDate = (key: string): string | null => {
    const value = String(formData.get(key) ?? '').trim()
    if (!value) return null
    if (!datePattern.test(value)) throw new Error(`${key} must use YYYY-MM-DD`)
    const parsed = new Date(`${value}T12:00:00Z`)
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new Error(`${key} must be a valid date`)
    }
    return value
  }
  const startsOn = parseDate('startsOn')
  const endsOn = parseDate('endsOn')
  if (startsOn && endsOn && startsOn > endsOn) {
    throw new Error('Start date must be on or before end date')
  }

  // Validate the IANA timezone before computeNextRunAt hands it to
  // Intl.DateTimeFormat, which throws a RangeError on unknown names.
  try {
    if (timezone.length > REPORT_SCHEDULE_LIMITS.timezoneChars) throw new Error('too long')
    new Intl.DateTimeFormat(undefined, { timeZone: timezone })
  } catch {
    throw new Error(`Unknown timezone "${timezone}". Use an IANA name like America/Toronto.`)
  }

  const recipientEmailsRaw = String(formData.get('recipientEmails') ?? '')
  if (recipientEmailsRaw.length > REPORT_SCHEDULE_LIMITS.recipientEmailListChars) {
    throw new Error('Recipient email list is too large')
  }
  const recipientEmails = normalizeReportRecipientEmails(
    recipientEmailsRaw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean),
  )
  const recipientUserIdsRaw = String(formData.get('recipientUserIds') ?? '')
  if (recipientUserIdsRaw.length > REPORT_SCHEDULE_LIMITS.recipientUserIdListChars) {
    throw new Error('Recipient member list is too large')
  }
  const recipientUserIds = normalizeReportRecipientUserIds(
    recipientUserIdsRaw
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  )
  assertReportRecipientLimit(recipientUserIds, recipientEmails)

  const filtersRaw = String(formData.get('filters') ?? '').trim()
  if (filtersRaw.length > REPORT_SCHEDULE_LIMITS.filtersChars) {
    throw new Error('Report filters are too large')
  }
  let filters: Record<string, unknown> = {}
  if (filtersRaw) {
    try {
      const parsed: unknown = JSON.parse(filtersRaw)
      assertBoundedReportFilters(parsed)
      filters = parsed
    } catch (err) {
      throw new Error(`Invalid filters JSON: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const emailSubjectValue = String(formData.get('emailSubject') ?? '').trim()
  const emailMessageValue = String(formData.get('emailMessage') ?? '').trim()
  if (emailSubjectValue.length > REPORT_SCHEDULE_LIMITS.emailSubjectChars) {
    throw new Error('Email subject is too long')
  }
  if (emailMessageValue.length > REPORT_SCHEDULE_LIMITS.emailMessageChars) {
    throw new Error('Email message is too long')
  }
  if (/[\r\n\u0000-\u001f\u007f]/.test(emailSubjectValue)) {
    throw new Error('Email subject contains invalid control characters')
  }

  return {
    name,
    cadence,
    repeatEvery,
    dayOfWeek,
    dayOfMonth,
    weekOfMonth,
    hour,
    minute,
    timezone,
    startsOn,
    endsOn,
    recipientUserIds,
    recipientEmails,
    filters,
    emailSubject: emailSubjectValue || null,
    emailMessage: emailMessageValue || null,
  }
}
