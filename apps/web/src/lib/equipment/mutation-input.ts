import {
  optionalDateInput,
  optionalTextInput,
  optionalUuidInput,
  requiredTextInput,
  requireEnumInput,
} from '../mutation-input'
import { EQUIPMENT_FIELD_GROUPS, type EquipmentNativeField } from './field-groups'

export const EQUIPMENT_STATUSES = [
  'in_service',
  'out_of_service',
  'in_repair',
  'lost',
  'retired',
] as const

export const EQUIPMENT_LOG_KINDS = [
  'note',
  'maintenance',
  'fuel',
  'incident',
  'modification',
] as const

export const EQUIPMENT_FILE_KINDS = [
  'certificate',
  'manual',
  'photo',
  'receipt',
  'warranty',
  'other',
] as const

export const WORK_ORDER_PRIORITIES = ['low', 'med', 'high'] as const

const TEXT_LIMITS = {
  name: 240,
  assetTag: 120,
  serialNumber: 240,
  description: 5_000,
  notes: 100_000,
} as const

const REQUIRED_TEXT_FIELDS = new Set<keyof typeof TEXT_LIMITS>(['name', 'assetTag'])
const NULLABLE_ID_FIELDS = new Set(['typeId', 'categoryId', 'preUseInspectionTypeId'])
const BOOLEAN_FIELDS = new Set(['requiresPreUseInspection'])
const REGISTRY_FIELDS = new Map<string, EquipmentNativeField>(
  EQUIPMENT_FIELD_GROUPS.flatMap((group) =>
    group.fields.map((field) => [field.field, field] as const),
  ),
)

function parseOptionalInteger(
  value: string,
  label: string,
  bounds: { min: number; max: number },
): number | null {
  const normalized = value.trim()
  if (!normalized) return null
  if (!/^-?\d+$/.test(normalized)) throw new Error(`${label} must be a whole number.`)
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    throw new Error(`${label} is outside the allowed range.`)
  }
  return parsed
}

function parseOptionalDecimal(
  value: string,
  label: string,
  bounds: { integerDigits: number; scale: number },
): string | null {
  const normalized = value.trim()
  if (!normalized) return null
  const pattern = new RegExp(`^\\d{1,${bounds.integerDigits}}(?:\\.\\d{1,${bounds.scale}})?$`)
  if (!pattern.test(normalized)) throw new Error(`${label} is invalid.`)
  return normalized
}

function parseRegistryValue(field: EquipmentNativeField, value: string): unknown {
  if (field.type === 'date') return optionalDateInput(value, field.label)
  if (field.type === 'select') {
    return requireEnumInput(
      value,
      (field.options ?? []).map((option) => option.value),
      field.label,
    )
  }
  if (field.type === 'text') return optionalTextInput(value, field.label, 500)

  switch (field.field) {
    case 'modelYear':
      return parseOptionalInteger(value, field.label, {
        min: 1800,
        max: new Date().getUTCFullYear() + 2,
      })
    case 'currentOdometer':
      return parseOptionalInteger(value, field.label, { min: 0, max: 2_147_483_647 })
    case 'purchasePrice':
      return parseOptionalDecimal(value, field.label, { integerDigits: 10, scale: 2 })
    case 'currentHours':
      return parseOptionalDecimal(value, field.label, { integerDigits: 9, scale: 1 })
    default:
      throw new Error('Field is not editable.')
  }
}

export function parseEquipmentAutosaveInput(
  fieldValue: unknown,
  rawValue: unknown,
): {
  field: string
  value: unknown
} {
  const field = requiredTextInput(fieldValue, 'Field', 64)
  const value = typeof rawValue === 'string' ? rawValue : ''

  if (field === 'status') {
    return { field, value: requireEnumInput(value, EQUIPMENT_STATUSES, 'Status') }
  }
  if (NULLABLE_ID_FIELDS.has(field)) {
    return { field, value: optionalUuidInput(value, 'Selected record') }
  }
  if (BOOLEAN_FIELDS.has(field)) {
    return { field, value: value === 'true' || value === 'on' || value === '1' }
  }
  if (field in TEXT_LIMITS) {
    const textField = field as keyof typeof TEXT_LIMITS
    return {
      field,
      value: REQUIRED_TEXT_FIELDS.has(textField)
        ? requiredTextInput(
            value,
            textField === 'assetTag' ? 'Asset tag' : 'Name',
            TEXT_LIMITS[textField],
          )
        : optionalTextInput(value, textField, TEXT_LIMITS[textField]),
    }
  }

  const registryField = REGISTRY_FIELDS.get(field)
  if (!registryField) throw new Error('Field is not editable.')
  return { field, value: parseRegistryValue(registryField, value) }
}

export function mergeEquipmentFileMetadata(
  existing: Record<string, unknown> | null,
  input: {
    itemId: string
    kind: (typeof EQUIPMENT_FILE_KINDS)[number]
    label: string | null
  },
): Record<string, unknown> {
  const existingEquipmentId = existing?.equipmentId
  if (existingEquipmentId && existingEquipmentId !== input.itemId) {
    throw new Error('This file is already attached to another equipment item.')
  }
  return {
    ...(existing ?? {}),
    equipmentId: input.itemId,
    kind: input.kind,
    label: input.label,
  }
}
