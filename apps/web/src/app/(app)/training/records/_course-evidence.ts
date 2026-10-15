import type { Database } from '@beaconhs/db'
import { materializeEvidenceTargetsObligations } from '@beaconhs/compliance'

/**
 * Refresh course compliance for every course a training-record mutation
 * touched (the old and new course of a retarget), inside the mutation's
 * transaction. Shared by the record actions and the record saver.
 */
export async function materializeCourseEvidence(
  tx: Database,
  tenantId: string,
  courseIds: readonly (string | null)[],
): Promise<void> {
  await materializeEvidenceTargetsObligations(
    tx,
    tenantId,
    [...new Set(courseIds.filter((id): id is string => Boolean(id)))].map((courseId) => ({
      sourceModule: 'training' as const,
      targetRef: { courseId },
    })),
  )
}
