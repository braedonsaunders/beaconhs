import { parseDatetimeLocal } from './datetime'
import {
  optionalTextInput,
  optionalUuidInput,
  optionalNumberInput,
  requiredTextInput,
  requireEnumInput,
  requireUuidInput,
} from './mutation-input'

export const MAX_TRAINING_CLASS_ATTENDEES = 1_000
const MAX_TRAINING_CLASS_COMPLETION_PAGE_SIZE = 100
/** One-line completion comment per attendee. */
export const MAX_TRAINING_CLASS_COMPLETION_NOTE_LENGTH = 300
const MAX_TRAINING_CLASS_TITLE_LENGTH = 200
const MAX_TRAINING_CLASS_NOTES_LENGTH = 20_000

export const TRAINING_CLASS_MUTABLE_FIELDS = [
  'courseId',
  'title',
  'schedule',
  'customerOrgUnitId',
  'location',
  'instructorTenantUserId',
  'capacity',
  'lengthDays',
  'hoursPerDay',
  'notes',
  'reminderHours',
] as const

export type TrainingClassMutableField = (typeof TRAINING_CLASS_MUTABLE_FIELDS)[number]

export type ParsedTrainingClassField =
  | { field: 'courseId'; value: string }
  | { field: 'title'; value: string }
  | { field: 'schedule'; value: { startsAt: Date; endsAt: Date } }
  | { field: 'customerOrgUnitId'; value: string | null }
  | { field: 'location'; value: string | null }
  | { field: 'instructorTenantUserId'; value: string | null }
  | { field: 'capacity'; value: number | null }
  | { field: 'lengthDays'; value: number | null }
  // Credited hours ride the wire (and the numeric column) as a decimal string.
  | { field: 'hoursPerDay'; value: string | null }
  | { field: 'notes'; value: string | null }
  | { field: 'reminderHours'; value: number | null }

export function parseTrainingClassField(
  fieldInput: unknown,
  value: unknown,
  timezone: string,
): ParsedTrainingClassField {
  const field = requireEnumInput(fieldInput, TRAINING_CLASS_MUTABLE_FIELDS, 'Class field')
  switch (field) {
    case 'courseId':
      return { field, value: requireUuidInput(value, 'Course') }
    case 'title':
      return {
        field,
        value: requiredTextInput(value, 'Class title', MAX_TRAINING_CLASS_TITLE_LENGTH),
      }
    case 'schedule':
      return { field, value: parseTrainingClassSchedule(value, timezone) }
    case 'location':
      return { field, value: optionalTextInput(value, 'Class location', 500) }
    case 'reminderHours': {
      const hours = value === '' ? null : Number(value)
      if (hours !== null && ![24, 48, 168].includes(hours)) {
        throw new Error('Choose a reminder time from the list.')
      }
      return { field, value: hours }
    }
    case 'customerOrgUnitId':
      return { field, value: optionalUuidInput(value, 'Customer') }
    case 'instructorTenantUserId':
      return { field, value: optionalUuidInput(value, 'Instructor') }
    case 'capacity':
      return {
        field,
        value: optionalNumberInput(value, 'Maximum attendees', {
          integer: true,
          min: 1,
          max: MAX_TRAINING_CLASS_ATTENDEES,
        }),
      }
    case 'lengthDays':
      return {
        field,
        value: optionalNumberInput(value, 'Days', { integer: true, min: 1, max: 366 }),
      }
    case 'hoursPerDay': {
      // Credited (paid) hours per class day: quarter-hour steps only.
      const hours = optionalNumberInput(value, 'Credited hours per day', {
        min: 0.25,
        max: 24,
      })
      if (hours == null) return { field, value: null }
      const quarters = Math.round(hours * 4)
      if (Math.abs(quarters / 4 - hours) > 1e-9) {
        throw new Error('Credited hours per day must be in quarter-hour steps (0.25).')
      }
      return { field, value: String(quarters / 4) }
    }
    case 'notes':
      return {
        field,
        value: optionalTextInput(value, 'Class notes', MAX_TRAINING_CLASS_NOTES_LENGTH),
      }
  }
}

/**
 * The class schedule as the record page edits it: start and end together, as
 * wall-clock `YYYY-MM-DDTHH:mm` values in the worker's timezone, so moving a
 * class to another day never passes through an end-before-start state.
 */
export function parseTrainingClassSchedule(
  value: unknown,
  timezone: string,
): { startsAt: Date; endsAt: Date } {
  const raw =
    value != null && typeof value === 'object' && !Array.isArray(value)
      ? (value as { startsAt?: unknown; endsAt?: unknown })
      : null
  const startsAt =
    typeof raw?.startsAt === 'string' ? parseDatetimeLocal(raw.startsAt, timezone) : null
  const endsAt = typeof raw?.endsAt === 'string' ? parseDatetimeLocal(raw.endsAt, timezone) : null
  if (!startsAt || !endsAt) throw new Error('Class schedule is invalid.')
  assertTrainingClassSchedule(startsAt, endsAt)
  return { startsAt, endsAt }
}

export function assertTrainingClassSchedule(startsAt: Date, endsAt: Date): void {
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
    throw new Error('Class schedule is invalid.')
  }
  if (endsAt <= startsAt) throw new Error('Class end time must be after its start time.')
}

export function assertTrainingClassCapacity(capacity: number | null, attendeeCount: number): void {
  if (!Number.isSafeInteger(attendeeCount) || attendeeCount < 0) {
    throw new Error('Class roster size is invalid.')
  }
  if (attendeeCount >= MAX_TRAINING_CLASS_ATTENDEES) {
    throw new Error(`A class can have at most ${MAX_TRAINING_CLASS_ATTENDEES} attendees.`)
  }
  if (capacity != null && attendeeCount >= capacity) throw new Error('This class is at capacity.')
}

export function requireTrainingClassId(value: unknown): string {
  return requireUuidInput(value, 'Training class')
}

type TrainingClassCompletionDecision = {
  attendeeId: string
  attended: boolean
  passed: boolean
  grade: number | null
  notes: string | null
}

export function parseTrainingClassCompletionPage(
  formData: FormData,
): TrainingClassCompletionDecision[] {
  const attendeeIds = formData
    .getAll('attendeeId')
    .map((value) => requireUuidInput(value, 'Class attendee'))
  if (
    attendeeIds.length < 1 ||
    attendeeIds.length > MAX_TRAINING_CLASS_COMPLETION_PAGE_SIZE ||
    new Set(attendeeIds).size !== attendeeIds.length
  ) {
    throw new Error('Completion page attendees are invalid.')
  }

  return attendeeIds.map((attendeeId) => {
    const attended = formData.get(`attended__${attendeeId}`) === 'on'
    const passed = formData.get(`passed__${attendeeId}`) === 'on'
    if (passed && !attended) throw new Error('A no-show cannot be marked as passed.')
    const grade = optionalNumberInput(formData.get(`grade__${attendeeId}`), 'Grade', {
      integer: true,
      min: 0,
      max: 100,
    })
    const notes = optionalTextInput(
      formData.get(`notes__${attendeeId}`),
      'Comment',
      MAX_TRAINING_CLASS_COMPLETION_NOTE_LENGTH,
    )
    return { attendeeId, attended, passed, grade, notes }
  })
}
