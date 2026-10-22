'use server'
import { signingResult } from '@/lib/hazid-signing-action-result'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { hazidAssessments, hazidAssessmentSignatures } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'
import { loadOwnSigningRequest } from '@/lib/hazid-signing-request'
import { freezeHazidSigning } from '@/lib/hazid-signing'
import { recordAuditInTransaction } from '@/lib/audit'
import { HazidSigningError } from '@/lib/hazid-signing-result'
export async function openCurrentSigningRequest(signatureId: string) {
  return signingResult(async () => {
    const ctx = await requireRequestContext()
    if (!isUuid(signatureId)) throw new HazidSigningError('Signature request not found')
    return ctx.db(async (tx) => {
      const initial = await loadOwnSigningRequest(ctx, tx, signatureId)
      if (initial.kind !== 'changed')
        throw new HazidSigningError('This request is no longer available. Reopen the signing link.')
      await tx
        .select({ id: hazidAssessments.id })
        .from(hazidAssessments)
        .where(
          and(
            eq(hazidAssessments.id, initial.assessment.id),
            eq(hazidAssessments.tenantId, ctx.tenantId),
          ),
        )
        .for('update')
      const current = await loadOwnSigningRequest(ctx, tx, signatureId)
      if (current.kind !== 'changed')
        throw new HazidSigningError('The assessment changed. Reopen the signing link.')
      await freezeHazidSigning(ctx, tx, current.assessment)
      await tx
        .update(hazidAssessmentSignatures)
        .set({
          requestId: randomUUID(),
          requestedAt: new Date(),
          requestExpiresAt: current.signature.requestExpiresAt,
        })
        .where(
          and(
            eq(hazidAssessmentSignatures.id, current.current.id),
            eq(hazidAssessmentSignatures.tenantId, ctx.tenantId),
          ),
        )
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'hazid_assessment',
        entityId: current.assessment.id,
        action: 'update',
        summary: 'Opened current signing version from an earlier request',
        metadata: {
          originalSignatureId: signatureId,
          signatureId: current.current.id,
          revision: current.assessment.signingRevision,
        },
      })
      return { signatureId: current.current.id }
    })
  })
}
