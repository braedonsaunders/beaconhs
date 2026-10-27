import { and, eq, isNull } from 'drizzle-orm'
import { lockFormResponseForMutation, type Database } from '@beaconhs/db'
import { formResponses, hazidAssessmentAppResponses } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { materializeFormResponseEvidenceChange } from './form-response-evidence'

export class FormResponseLockedError extends Error {
  override readonly name = 'FormResponseLockedError'
}

/** Archive a response and release any JSA app slot atomically. Caller audits
 * and emits the Flow event after the transaction commits. */
export async function archiveFormResponseInTransaction(
  tx: Database,
  ctx: RequestContext,
  responseId: string,
  expectedTemplateId?: string,
) {
  const before = await lockFormResponseForMutation(tx, ctx.tenantId!, responseId)
  if (!before || (expectedTemplateId && before.templateId !== expectedTemplateId)) return null
  if (before.locked) throw new FormResponseLockedError('Locked responses cannot be deleted')
  const deletedAt = new Date()
  const [archived] = await tx
    .update(formResponses)
    .set({ deletedAt })
    .where(and(eq(formResponses.id, responseId), isNull(formResponses.deletedAt)))
    .returning()
  if (!archived) return null
  await tx
    .delete(hazidAssessmentAppResponses)
    .where(eq(hazidAssessmentAppResponses.responseId, responseId))
  await materializeFormResponseEvidenceChange(tx, ctx.tenantId!, before, archived)
  return { before, archived, deletedAt: archived.deletedAt ?? deletedAt }
}
