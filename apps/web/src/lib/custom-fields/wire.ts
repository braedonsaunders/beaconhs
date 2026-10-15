// The wire form of a custom-field value: what the record page's input shows
// and sends, and what the record saver compares against (see record-op.ts).
// Every type travels as a string, exactly as `coerceCustomFieldValue` reads
// it: '' for empty, 'true'/'false' for switches, and a JSON array for
// multi-select. Pure — imported by the client input and the server saver.

import type { CustomFieldConfig, CustomFieldType } from '@beaconhs/forms-core'

export function customFieldWireValue(
  def: { fieldType: CustomFieldType; config: CustomFieldConfig | null },
  stored: unknown,
): string {
  const allowed = new Set((def.config?.options ?? []).map((option) => option.value))
  switch (def.fieldType) {
    case 'boolean':
      return stored === true ? 'true' : 'false'
    case 'select':
      return typeof stored === 'string' && allowed.has(stored) ? stored : ''
    case 'multi_select':
      return JSON.stringify(
        Array.isArray(stored)
          ? stored.filter(
              (value): value is string => typeof value === 'string' && allowed.has(value),
            )
          : [],
      )
    default:
      return typeof stored === 'string' || typeof stored === 'number' ? String(stored) : ''
  }
}

const CUSTOM_OP_PREFIX = 'custom:'

/** The op key a custom field's input binds to on its record. */
export function customFieldOpKey(key: string): string {
  return `${CUSTOM_OP_PREFIX}${key}`
}

/** The custom-field key behind an op, or null for any other op. */
export function customFieldKeyOf(op: string): string | null {
  return op.startsWith(CUSTOM_OP_PREFIX) ? op.slice(CUSTOM_OP_PREFIX.length) : null
}
