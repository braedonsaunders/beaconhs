// Shared helpers for custom-field values stored on a record's
// `metadata.custom` (equipment, PPE items, people, locations). Used by the
// definition actions (value migrations, purges) and by the record savers that
// apply queued custom-field edits (see record-op.ts).

import { and, eq, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { CUSTOM_FIELD_ENTITY_KINDS, type CustomFieldEntityKind } from '@beaconhs/forms-core'
import { equipmentItems, orgUnits, people, ppeItems } from '@beaconhs/db/schema'

export const CUSTOM_FIELD_AUDIT_ENTITY: Record<CustomFieldEntityKind, string> = {
  equipment: 'equipment',
  ppe: 'ppe_item',
  person: 'person',
  location: 'org_unit',
}

export function isEntityKind(v: string): v is CustomFieldEntityKind {
  return (CUSTOM_FIELD_ENTITY_KINDS as readonly string[]).includes(v)
}

// The metadata column for each kind, plus the table-typed updater. Switching
// here (rather than a generic PgTable ref) keeps the drizzle update type-safe.
export function metadataValueExpr(
  col: AnyColumn,
  key: string,
  value: string | number | boolean | string[] | null,
): SQL {
  // Keep the path parameterized even though definition keys are validated.
  // This also fails safely if an older/imported row ever contains a bad key.
  const path = sql`ARRAY['custom', ${key}]::text[]`
  if (value === null) return sql`coalesce(${col}, '{}'::jsonb) #- ${path}`
  return sql`jsonb_set(coalesce(${col}, '{}'::jsonb), ${path}, ${JSON.stringify(value)}::jsonb, true)`
}

export async function writeMetadataInTransaction(
  tx: Database,
  kind: CustomFieldEntityKind,
  id: string,
  key: string,
  value: string | number | boolean | string[] | null,
  subtypeId: string | null,
): Promise<boolean> {
  switch (kind) {
    case 'equipment': {
      const [updated] = await tx
        .update(equipmentItems)
        .set({ metadata: metadataValueExpr(equipmentItems.metadata, key, value) })
        .where(
          and(
            eq(equipmentItems.id, id),
            isNull(equipmentItems.deletedAt),
            subtypeId ? eq(equipmentItems.typeId, subtypeId) : undefined,
          ),
        )
        .returning({ id: equipmentItems.id })
      return Boolean(updated)
    }
    case 'ppe': {
      const [updated] = await tx
        .update(ppeItems)
        .set({ metadata: metadataValueExpr(ppeItems.metadata, key, value) })
        .where(
          and(
            eq(ppeItems.id, id),
            isNull(ppeItems.deletedAt),
            subtypeId ? eq(ppeItems.typeId, subtypeId) : undefined,
          ),
        )
        .returning({ id: ppeItems.id })
      return Boolean(updated)
    }
    case 'person': {
      const [updated] = await tx
        .update(people)
        .set({ metadata: metadataValueExpr(people.metadata, key, value) })
        .where(and(eq(people.id, id), isNull(people.deletedAt)))
        .returning({ id: people.id })
      return Boolean(updated)
    }
    case 'location': {
      const [updated] = await tx
        .update(orgUnits)
        .set({ metadata: metadataValueExpr(orgUnits.metadata, key, value) })
        .where(and(eq(orgUnits.id, id), isNull(orgUnits.deletedAt)))
        .returning({ id: orgUnits.id })
      return Boolean(updated)
    }
  }
}
