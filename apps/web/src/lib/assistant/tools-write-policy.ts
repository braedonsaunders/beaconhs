import { z } from 'zod'

const CA_SEVERITY = ['low', 'medium', 'high', 'critical'] as const
const INCIDENT_TYPE = [
  'injury',
  'illness',
  'near_miss',
  'property_damage',
  'environmental',
  'security',
  'other',
] as const
const INCIDENT_SEVERITY = [
  'first_aid_only',
  'medical_aid',
  'lost_time',
  'fatality',
  'no_injury',
] as const

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function isIsoDateTime(value: string): boolean {
  const [datePart, timePart, extra] = value.split('T')
  if (!datePart || !timePart || extra !== undefined || !isCalendarDate(datePart)) return false
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
    timePart,
  )
  if (!match) return false
  const [, hour, minute, second = '0', offsetHour = '0', offsetMinute = '0'] = match
  if (
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    Number(offsetHour) > 23 ||
    Number(offsetMinute) > 59
  ) {
    return false
  }
  return !Number.isNaN(new Date(value).valueOf())
}

function toolInputError(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'invalid_input: Check the drafted fields and try again.'
  const field = issue.path[0] ? String(issue.path[0]) : 'input'
  return `invalid_${field}: ${issue.message}`
}

export const correctiveActionDraftSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'title must be at least 3 characters after trimming')
    .max(200, 'title must be 200 characters or fewer'),
  description: z
    .string()
    .trim()
    .max(4000, 'description must be 4,000 characters or fewer')
    .optional(),
  severity: z.enum(CA_SEVERITY).optional(),
  dueOn: z
    .string()
    .refine(isCalendarDate, 'dueOn must be a real calendar date in YYYY-MM-DD format')
    .optional()
    .describe('Due date as YYYY-MM-DD'),
  fromIncidentId: z.string().uuid().optional().describe('Incident this CA addresses'),
})

export const incidentDraftSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'title must be at least 3 characters after trimming')
    .max(200, 'title must be 200 characters or fewer'),
  description: z
    .string()
    .trim()
    .max(4000, 'description must be 4,000 characters or fewer')
    .optional(),
  type: z.enum(INCIDENT_TYPE),
  severity: z.enum(INCIDENT_SEVERITY),
  occurredAt: z
    .string()
    .refine(isIsoDateTime, 'occurredAt must be a valid ISO datetime with a timezone')
    .optional()
    .describe('ISO datetime with timezone; defaults to now'),
  location: z.string().trim().max(200, 'location must be 200 characters or fewer').optional(),
})

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

export function parseCorrectiveActionDraftInput(
  input: unknown,
): ParseResult<z.infer<typeof correctiveActionDraftSchema>> {
  const parsed = correctiveActionDraftSchema.safeParse(input)
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: toolInputError(parsed.error) }
}

export function parseIncidentDraftInput(
  input: unknown,
): ParseResult<z.infer<typeof incidentDraftSchema>> {
  const parsed = incidentDraftSchema.safeParse(input)
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: toolInputError(parsed.error) }
}
