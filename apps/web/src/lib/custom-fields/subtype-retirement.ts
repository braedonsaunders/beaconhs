import { and, count, eq, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { customFieldDefinitions } from '@beaconhs/db/schema'
import type { CustomFieldEntityKind } from '@beaconhs/forms-core'

export async function countScopedCustomFields(
  tx: Database,
  tenantId: string,
  kind: Extract<CustomFieldEntityKind, 'equipment' | 'ppe'>,
  subtypeId: string,
): Promise<number> {
  const [row] = await tx
    .select({ count: count() })
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.tenantId, tenantId),
        eq(customFieldDefinitions.entityKind, kind),
        eq(customFieldDefinitions.subtypeId, subtypeId),
        isNull(customFieldDefinitions.deletedAt),
      ),
    )
  return Number(row?.count ?? 0)
}

/** Polymorphic subtype scopes have no physical FK, so deletion must block here. */
export async function assertSubtypeHasNoCustomFields(
  tx: Database,
  tenantId: string,
  kind: Extract<CustomFieldEntityKind, 'equipment' | 'ppe'>,
  subtypeId: string,
): Promise<void> {
  const fields = await countScopedCustomFields(tx, tenantId, kind, subtypeId)
  if (fields > 0) {
    throw new Error(
      `Cannot delete — ${fields} custom field${fields === 1 ? '' : 's'} are scoped to this type. Delete or move them first.`,
    )
  }
}
