// Shared parser/validator for the schedule form's field contract. The create
// and update server actions post the exact same fields; parsing them in one
// place keeps validation identical (hour/minute/day ranges, timezone,
// recipients, filters JSON) so the two paths cannot drift.

type ScheduleCadence = 'daily' | 'weekly' | 'monthly'

type ParsedScheduleForm = {
  name: string
  cadence: ScheduleCadence
  dayOfWeek: number | null
  dayOfMonth: number | null
  hour: number
  minute: number
  timezone: string
  recipientUserIds: string[]
  recipientEmails: string[]
  filters: Record<string, unknown>
}

const CADENCES: readonly ScheduleCadence[] = ['daily', 'weekly', 'monthly']

function parseIntField(raw: FormDataEntryValue | null, fallback: number): number {
  const s = String(raw ?? '').trim()
  return s === '' ? fallback : Number(s)
}

export function parseScheduleForm(formData: FormData): ParsedScheduleForm {
  const name = String(formData.get('name') ?? '').trim()
  const cadence = String(formData.get('cadence') ?? '') as ScheduleCadence
  const hour = parseIntField(formData.get('hour'), 7)
  const minute = parseIntField(formData.get('minute'), 0)
  const timezone = String(formData.get('timezone') ?? '').trim() || 'America/Toronto'

  if (!name) throw new Error('Name is required')
  if (!CADENCES.includes(cadence)) throw new Error('Invalid cadence')
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('Hour must be a whole number between 0 and 23')
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error('Minute must be a whole number between 0 and 59')
  }

  const dayOfWeek = cadence === 'weekly' ? parseIntField(formData.get('dayOfWeek'), 1) : null
  const dayOfMonth = cadence === 'monthly' ? parseIntField(formData.get('dayOfMonth'), 1) : null
  if (
    cadence === 'weekly' &&
    (dayOfWeek === null || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)
  ) {
    throw new Error('Day of week must be between 0 (Sunday) and 6 (Saturday)')
  }
  if (
    cadence === 'monthly' &&
    (dayOfMonth === null || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)
  ) {
    throw new Error('Day of month must be between 1 and 31')
  }

  // Validate the IANA timezone before computeNextRunAt hands it to
  // Intl.DateTimeFormat, which throws a RangeError on unknown names.
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timezone })
  } catch {
    throw new Error(`Unknown timezone "${timezone}". Use an IANA name like America/Toronto.`)
  }

  const recipientEmails = String(formData.get('recipientEmails') ?? '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
  const recipientUserIds = String(formData.get('recipientUserIds') ?? '')
    .split(/[\n,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const filtersRaw = String(formData.get('filters') ?? '').trim()
  let filters: Record<string, unknown> = {}
  if (filtersRaw) {
    try {
      const parsed: unknown = JSON.parse(filtersRaw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object')
      }
      filters = parsed as Record<string, unknown>
    } catch (err) {
      throw new Error(`Invalid filters JSON: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return {
    name,
    cadence,
    dayOfWeek,
    dayOfMonth,
    hour,
    minute,
    timezone,
    recipientUserIds,
    recipientEmails,
    filters,
  }
}
