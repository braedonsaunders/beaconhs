import {
  optionalTextInput,
  requireEnumInput,
  requireRecordInput,
  requiredTextInput,
  requireUuidInput,
} from '../../../../lib/mutation-input'

export const TRAINING_EXTRA_FIELD_KEY_MAX = 120
export const TRAINING_EXTRA_FIELD_VALUE_MAX = 500
export const TRAINING_EXTRA_FIELD_OWNER_TYPES = ['skill', 'skill_type', 'authority'] as const

export type TrainingExtraFieldOwnerType = (typeof TRAINING_EXTRA_FIELD_OWNER_TYPES)[number]

export function parseExtraFieldInput(value: unknown): {
  ownerType: TrainingExtraFieldOwnerType
  ownerId: string
  fieldKey: string
  fieldValue: string | null
} {
  const input = requireRecordInput(value, 'Additional field')
  if (input.fieldValue != null && typeof input.fieldValue !== 'string') {
    throw new Error('Field value is invalid.')
  }
  return {
    ownerType: requireEnumInput(input.ownerType, TRAINING_EXTRA_FIELD_OWNER_TYPES, 'Owner type'),
    ownerId: requireUuidInput(input.ownerId, 'Owner'),
    fieldKey: requiredTextInput(input.fieldKey, 'Field name', TRAINING_EXTRA_FIELD_KEY_MAX),
    fieldValue: optionalTextInput(input.fieldValue, 'Field value', TRAINING_EXTRA_FIELD_VALUE_MAX),
  }
}

export function parseDeleteExtraFieldInput(value: unknown): {
  id: string
  ownerType: TrainingExtraFieldOwnerType
  ownerId: string
} {
  const input = requireRecordInput(value, 'Additional field')
  return {
    id: requireUuidInput(input.id, 'Additional field'),
    ownerType: requireEnumInput(input.ownerType, TRAINING_EXTRA_FIELD_OWNER_TYPES, 'Owner type'),
    ownerId: requireUuidInput(input.ownerId, 'Owner'),
  }
}
