import { and, count, eq } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { ppeItems, ppeTypes } from '@beaconhs/db/schema'
import { assertComplianceTargetCanRetire } from '@beaconhs/compliance'
import { assertSubtypeHasNoCustomFields } from '@/lib/custom-fields/subtype-retirement'

/**
 * Canonical PPE-type deletion policy for both list and detail actions.
 * Callers keep the audit write in the same transaction.
 */
export async function deletePpeTypeInTransaction(
  tx: Database,
  tenantId: string,
  typeId: string,
): Promise<void> {
  const [type] = await tx
    .select({ id: ppeTypes.id })
    .from(ppeTypes)
    .where(and(eq(ppeTypes.tenantId, tenantId), eq(ppeTypes.id, typeId)))
    .limit(1)
    .for('update')
  if (!type) throw new Error('PPE type not found')

  await assertComplianceTargetCanRetire(tx, tenantId, 'ppe_type', typeId)
  await assertSubtypeHasNoCustomFields(tx, tenantId, 'ppe', typeId)

  const [tally] = await tx
    .select({ c: count() })
    .from(ppeItems)
    .where(and(eq(ppeItems.tenantId, tenantId), eq(ppeItems.typeId, typeId)))
  const itemCount = Number(tally?.c ?? 0)
  if (itemCount > 0) {
    throw new Error(
      `Cannot delete — ${itemCount} item${itemCount === 1 ? '' : 's'} reference this type`,
    )
  }

  await tx.delete(ppeTypes).where(and(eq(ppeTypes.tenantId, tenantId), eq(ppeTypes.id, typeId)))
}
