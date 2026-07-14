import type { Database } from '@beaconhs/db'
import { materializeEvidenceTargetsObligations } from '@beaconhs/compliance'

/**
 * Reconcile every equipment obligation affected by an item/schedule mutation.
 * Target ids are de-duplicated so bulk and type-retarget operations share the
 * compliance package's deterministic owner-lock order.
 */
export async function materializeEquipmentTypeEvidence(
  tx: Database,
  tenantId: string,
  typeIds: readonly (string | null | undefined)[],
): Promise<void> {
  await materializeEvidenceTargetsObligations(
    tx,
    tenantId,
    [...new Set(typeIds.filter((id): id is string => Boolean(id)))].map((equipmentTypeId) => ({
      sourceModule: 'equipment_inspection' as const,
      targetRef: { equipmentTypeId },
    })),
  )
}

/** Reconcile every PPE obligation affected by an item/inspection mutation. */
export async function materializePpeTypeEvidence(
  tx: Database,
  tenantId: string,
  typeIds: readonly (string | null | undefined)[],
): Promise<void> {
  await materializeEvidenceTargetsObligations(
    tx,
    tenantId,
    [...new Set(typeIds.filter((id): id is string => Boolean(id)))].map((ppeTypeId) => ({
      sourceModule: 'ppe_inspection' as const,
      targetRef: { ppeTypeId },
    })),
  )
}
