import {
  optionalDateInput,
  optionalNumberInput,
  optionalTextInput,
  requiredDateInput,
  requireEnumInput,
  requireUuidInput,
} from '../../../../lib/mutation-input'

export const TRAINING_RECORD_SOURCES = [
  'class',
  'self_paced',
  'evaluator',
  'external_upload',
  'migrated',
] as const

export type TrainingRecordFieldUpdate =
  | { field: 'personId'; value: string }
  | { field: 'courseId'; value: string }
  | { field: 'source'; value: (typeof TRAINING_RECORD_SOURCES)[number] }
  | { field: 'completedOn'; value: string }
  | { field: 'expiresOn'; value: string | null }
  | { field: 'grade'; value: number | null }
  | { field: 'instructor'; value: string | null }
  | { field: 'details'; value: string | null }
  | { field: 'notes'; value: string | null }

const MAX_INSTRUCTOR_LENGTH = 300
const MAX_RECORD_TEXT_LENGTH = 10_000
const MAX_REVOCATION_REASON_LENGTH = 1_000

function requireStringValue(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Training record value is invalid.')
  return value
}

export function parseTrainingRecordFieldUpdate(
  fieldInput: unknown,
  valueInput: unknown,
): TrainingRecordFieldUpdate {
  const field = typeof fieldInput === 'string' ? fieldInput.trim() : ''
  const value = requireStringValue(valueInput)
  switch (field) {
    case 'personId':
      return { field, value: requireUuidInput(value, 'Person') }
    case 'courseId':
      return { field, value: requireUuidInput(value, 'Course') }
    case 'source':
      return {
        field,
        value: requireEnumInput(value, TRAINING_RECORD_SOURCES, 'Record source'),
      }
    case 'completedOn':
      return { field, value: requiredDateInput(value, 'Completed date') }
    case 'expiresOn':
      return { field, value: optionalDateInput(value, 'Expiry date') }
    case 'grade':
      return {
        field,
        value: optionalNumberInput(value, 'Grade', { min: 0, max: 100, integer: true }),
      }
    case 'instructor':
      return {
        field,
        value: optionalTextInput(value, 'Instructor', MAX_INSTRUCTOR_LENGTH),
      }
    case 'details':
      return {
        field,
        value: optionalTextInput(value, 'Details', MAX_RECORD_TEXT_LENGTH),
      }
    case 'notes':
      return {
        field,
        value: optionalTextInput(value, 'Notes', MAX_RECORD_TEXT_LENGTH),
      }
    default:
      throw new Error('Training record field is invalid.')
  }
}

export function assertTrainingRecordDateOrder(completedOn: string, expiresOn: string | null): void {
  if (expiresOn && expiresOn < completedOn) {
    throw new Error('Expiry date cannot be before the completed date.')
  }
}

export function parseTrainingRecordRevocationReason(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error('Revocation reason is invalid.')
  return optionalTextInput(value, 'Revocation reason', MAX_REVOCATION_REASON_LENGTH)
}
