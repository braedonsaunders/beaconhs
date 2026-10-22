import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { activePeopleWhere, activeTenantUsersWhere, type Database } from '@beaconhs/db'
import {
  hazidAssessments,
  hazidAssessmentSignatures,
  people,
  tenantUsers,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

/** Authenticate the original emailed identity before revealing any replacement slot. */
export async function loadOwnSigningRequest(
  ctx: RequestContext,
  tx: Database,
  signatureId: string,
) {
  const [original] = await tx
    .select({ signature: hazidAssessmentSignatures, assessment: hazidAssessments })
    .from(hazidAssessmentSignatures)
    .innerJoin(
      hazidAssessments,
      and(
        eq(hazidAssessments.id, hazidAssessmentSignatures.assessmentId),
        eq(hazidAssessments.tenantId, hazidAssessmentSignatures.tenantId),
      ),
    )
    .innerJoin(
      people,
      and(
        eq(people.id, hazidAssessmentSignatures.personId),
        eq(people.tenantId, hazidAssessmentSignatures.tenantId),
      ),
    )
    .innerJoin(
      tenantUsers,
      and(eq(tenantUsers.userId, people.userId), eq(tenantUsers.tenantId, people.tenantId)),
    )
    .where(
      and(
        eq(hazidAssessmentSignatures.tenantId, ctx.tenantId),
        eq(hazidAssessmentSignatures.id, signatureId),
        eq(people.userId, ctx.userId),
        activePeopleWhere(),
        activeTenantUsersWhere(),
        isNull(hazidAssessments.deletedAt),
      ),
    )
    .limit(1)
  if (!original?.signature.requestId) return { kind: 'unavailable' as const }
  if (
    original.signature.revision === original.assessment.signingRevision &&
    original.signature.signedAt
  )
    return { kind: 'signed' as const, ...original }
  if (!original.signature.requestExpiresAt || original.signature.requestExpiresAt <= new Date())
    return { kind: 'expired' as const }
  if (
    original.signature.revision === original.assessment.signingRevision &&
    original.assessment.signingFrozenAt
  )
    return { kind: 'ready' as const, ...original }
  const [current] = await tx
    .select()
    .from(hazidAssessmentSignatures)
    .where(
      and(
        eq(hazidAssessmentSignatures.tenantId, ctx.tenantId),
        eq(hazidAssessmentSignatures.assessmentId, original.assessment.id),
        eq(hazidAssessmentSignatures.revision, original.assessment.signingRevision),
        eq(hazidAssessmentSignatures.personId, original.signature.personId!),
      ),
    )
    .limit(1)
  if (!current) return { kind: 'removed' as const }
  return { kind: 'changed' as const, ...original, current }
}
