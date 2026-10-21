import type { Database } from '@beaconhs/db'
import { materializeEvidenceTargetsObligations } from '@beaconhs/compliance'

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
