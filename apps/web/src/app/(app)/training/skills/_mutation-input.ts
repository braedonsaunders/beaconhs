import {
  optionalDateInput,
  optionalTextInput,
  requiredDateInput,
  requiredTextInput,
  requireEnumInput,
  requireUuidInput,
} from '../../../../lib/mutation-input'

const SKILL_FILE_KINDS = ['certificate', 'evidence', 'photo', 'other'] as const
type SkillFileKind = (typeof SKILL_FILE_KINDS)[number]

export type SkillAssignmentFieldUpdate =
  | { field: 'personId'; value: string }
  | { field: 'skillTypeId'; value: string }
  | { field: 'grantedOn'; value: string }
  | { field: 'expiresOn'; value: string | null }
  | { field: 'notes'; value: string | null }

const MAX_SKILL_NOTES_LENGTH = 10_000
const MAX_FILE_LABEL_LENGTH = 300
const MAX_REVOCATION_REASON_LENGTH = 1_000

function requireStringValue(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Skill assignment value is invalid.')
  return value
}

export function parseSkillAssignmentFieldUpdate(
  fieldInput: unknown,
  valueInput: unknown,
): SkillAssignmentFieldUpdate {
  const field = typeof fieldInput === 'string' ? fieldInput.trim() : ''
  const value = requireStringValue(valueInput)
  switch (field) {
    case 'personId':
      return { field, value: requireUuidInput(value, 'Person') }
    case 'skillTypeId':
      return { field, value: requireUuidInput(value, 'Skill type') }
    case 'grantedOn':
      return { field, value: requiredDateInput(value, 'Granted date') }
    case 'expiresOn':
      return { field, value: optionalDateInput(value, 'Expiry date') }
    case 'notes':
      return {
        field,
        value: optionalTextInput(value, 'Notes', MAX_SKILL_NOTES_LENGTH),
      }
    default:
      throw new Error('Skill assignment field is invalid.')
  }
}

export function parseSkillFileInput(input: unknown): {
  assignmentId: string
  attachmentId: string
  label: string
  kind: SkillFileKind
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('File details are invalid.')
  }
  const candidate = input as Record<string, unknown>
  return {
    assignmentId: requireUuidInput(candidate.assignmentId, 'Skill assignment'),
    attachmentId: requireUuidInput(candidate.attachmentId, 'Attachment'),
    label: requiredTextInput(candidate.label, 'Label', MAX_FILE_LABEL_LENGTH),
    kind: requireEnumInput(candidate.kind, SKILL_FILE_KINDS, 'File kind'),
  }
}

export function parseRevocationReason(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error('Revocation reason is invalid.')
  return optionalTextInput(value, 'Revocation reason', MAX_REVOCATION_REASON_LENGTH)
}

export function assertSkillAssignmentDateOrder(grantedOn: string, expiresOn: string | null): void {
  if (expiresOn && expiresOn < grantedOn) {
    throw new Error('Expiry date cannot be before the granted date.')
  }
}
