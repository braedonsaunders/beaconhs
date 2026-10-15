// Queued custom-field edits on a record page (`custom:<key>` ops). Each host
// module's record saver (people, locations, equipment, PPE items) resolves
// these ops here after locking its own record, so a custom-field value is
// written under the same permission, visibility, and lock as the record.
// The definition is the contract: a shared row lock serializes the value
// write against definition edits and deletion, and the value is coerced with
// the same rules the designer enforces.

import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  coerceCustomFieldValue,
  isValidCustomFieldKey,
  readCustomFieldValues,
  type CustomFieldConfig,
  type CustomFieldEntityKind,
  type CustomFieldType,
} from '@beaconhs/forms-core'
import { customFieldDefinitions } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAuditInTransaction } from '@/lib/audit'
import { RecordEditRejection, recordOp, type ErasedRecordOp } from '@/lib/record-sync/edits'
import { entityConfig } from './config'
import { CUSTOM_FIELD_AUDIT_ENTITY, writeMetadataInTransaction } from './values'
import { customFieldKeyOf, customFieldWireValue } from './wire'

/** True for a queued custom-field edit (its op audits itself). */
export function isCustomFieldOp(op: string): boolean {
  return customFieldKeyOf(op) !== null
}

type StoredValue = string | number | boolean | string[] | null

/**
 * Resolve a `custom:<key>` op against a locked record. Returns null for an
 * unknown, inactive, or deleted definition (the edit is refused).
 */
export async function customFieldRecordOp(
  tx: Database,
  ctx: RequestContext,
  args: {
    kind: CustomFieldEntityKind
    recordId: string
    /** The locked record's `metadata` (updated in place on write). */
    record: { metadata: unknown }
    op: string
  },
): Promise<ErasedRecordOp | null> {
  const key = customFieldKeyOf(args.op)
  if (key === null || !isValidCustomFieldKey(key)) return null
  const [row] = await tx
    .select()
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.entityKind, args.kind),
        eq(customFieldDefinitions.key, key),
        eq(customFieldDefinitions.isActive, true),
        isNull(customFieldDefinitions.deletedAt),
      ),
    )
    .limit(1)
    .for('share')
  if (!row) return null
  const def = {
    key: row.key,
    label: row.label,
    fieldType: row.fieldType as CustomFieldType,
    required: row.required,
    config: (row.config ?? null) as CustomFieldConfig | null,
  }
  const values = readCustomFieldValues(args.record.metadata as Record<string, unknown> | null)
  const current = (values[key] ?? null) as StoredValue
  return recordOp<StoredValue>({
    current,
    parse: (wire) => {
      if (typeof wire !== 'string') throw new RecordEditRejection(`${def.label} is invalid.`)
      if (
        args.kind === 'equipment' &&
        key === 'condition' &&
        wire !== '' &&
        !/^[1-5]$/.test(wire)
      ) {
        throw new RecordEditRejection('Choose a condition from 1 to 5 stars.')
      }
      const coerced = coerceCustomFieldValue(def, wire)
      if (!coerced.ok) throw new RecordEditRejection(coerced.error)
      return coerced.value
    },
    format: (value) => customFieldWireValue(def, value),
    write: async (value) => {
      const updated = await writeMetadataInTransaction(
        tx,
        args.kind,
        args.recordId,
        key,
        value,
        row.subtypeId,
      )
      if (!updated) {
        throw new RecordEditRejection(
          `This custom field does not apply to the selected ${entityConfig(args.kind).singular}.`,
        )
      }
      await recordAuditInTransaction(tx, ctx, {
        entityType: CUSTOM_FIELD_AUDIT_ENTITY[args.kind],
        entityId: args.recordId,
        action: 'update',
        summary: `Updated custom field "${row.label}"`,
        after: { [`custom.${key}`]: value },
      })
      const metadata = (args.record.metadata ?? {}) as Record<string, unknown>
      args.record.metadata = {
        ...metadata,
        custom: { ...values, [key]: value },
      }
    },
  })
}
