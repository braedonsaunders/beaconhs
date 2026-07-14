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
const MAX_TRAINING_CLASS_TITLE_LENGTH = 200
const MAX_TRAINING_CLASS_NOTES_LENGTH = 20_000

const TRAINING_CLASS_MUTABLE_FIELDS = [
  'courseId',
  'title',
  'startsAt',
  'endsAt',
  'siteOrgUnitId',
  'instructorTenantUserId',
  'capacity',
  'notes',
] as const

type TrainingClassMutableField = (typeof TRAINING_CLASS_MUTABLE_FIELDS)[number]

export type ParsedTrainingClassField =
  | { field: 'courseId'; value: string }
  | { field: 'title'; value: string }
  | { field: 'startsAt'; value: Date }
  | { field: 'endsAt'; value: Date }
  | { field: 'siteOrgUnitId'; value: string | null }
  | { field: 'instructorTenantUserId'; value: string | null }
  | { field: 'capacity'; value: number | null }
  | { field: 'notes'; value: string | null }

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
    case 'startsAt':
    case 'endsAt': {
      const raw = typeof value === 'string' ? value.trim() : ''
      const parsed = parseDatetimeLocal(raw, timezone)
      if (!parsed) throw new Error(`${field === 'startsAt' ? 'Start' : 'End'} time is invalid.`)
      return { field, value: parsed }
    }
    case 'siteOrgUnitId':
      return { field, value: optionalUuidInput(value, 'Site') }
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
    case 'notes':
      return {
        field,
        value: optionalTextInput(value, 'Class notes', MAX_TRAINING_CLASS_NOTES_LENGTH),
      }
  }
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
    return { attendeeId, attended, passed, grade }
  })
}
