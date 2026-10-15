import type { Database } from '@beaconhs/db'
import { materializeEvidenceTargetsObligations } from '@beaconhs/compliance'

/**
 * Refresh skill-requirement compliance for every skill type a skill-ticket
 * mutation touched (the old and new type of a retarget), inside the
 * mutation's transaction. Shared by the skill actions and the skill saver.
 */
export async function materializeSkillEvidence(
  tx: Database,
  tenantId: string,
  skillTypeIds: readonly (string | null)[],
): Promise<void> {
  await materializeEvidenceTargetsObligations(
    tx,
    tenantId,
    [...new Set(skillTypeIds.filter((id): id is string => Boolean(id)))].map((skillTypeId) => ({
      sourceModule: 'skill_requirement' as const,
      targetRef: { skillTypeId },
    })),
  )
}
