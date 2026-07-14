import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from './client'
import { formResponses, hazidAssessments } from './schema'

export const FORM_RESPONSE_PARENT_LOCKED_MESSAGE =
  'This response belongs to a locked hazard assessment. Unlock the assessment before making changes.'

export class FormResponseParentLockedError extends Error {
  override readonly name = 'FormResponseParentLockedError'

  constructor() {
    super(FORM_RESPONSE_PARENT_LOCKED_MESSAGE)
  }
}

export class FormResponseParentIntegrityError extends Error {
  override readonly name = 'FormResponseParentIntegrityError'
}

export type FormResponseSource = Pick<
  typeof formResponses.$inferSelect,
  'sourceEntityType' | 'sourceEntityId'
>

export function hazardAssessmentParentId(source: FormResponseSource): string | null {
  if (source.sourceEntityType !== 'hazid_assessment') return null
  if (!source.sourceEntityId) {
    throw new FormResponseParentIntegrityError(
      'Hazard-assessment response is missing its parent assessment identifier.',
    )
  }
  return source.sourceEntityId
}

/**
 * Lock a form response before a generic mutation while respecting a linked
 * Hazard assessment's signed/read-only lifecycle.
 *
 * Lock order is deliberately parent -> response, matching the HazID lock
 * action. The first unlocked read discovers the optional parent; after taking
 * the parent lock we lock the response and revalidate that the source link did
 * not change concurrently. Callers must perform their write in this same
 * transaction.
 */
export async function lockFormResponseForMutation(
  tx: Database,
  tenantId: string,
  responseId: string,
): Promise<typeof formResponses.$inferSelect | null> {
  const [snapshot] = await tx
    .select({
      sourceEntityType: formResponses.sourceEntityType,
      sourceEntityId: formResponses.sourceEntityId,
    })
    .from(formResponses)
    .where(
      and(
        eq(formResponses.tenantId, tenantId),
        eq(formResponses.id, responseId),
        isNull(formResponses.deletedAt),
      ),
    )
    .limit(1)
  if (!snapshot) return null

  const parentId = hazardAssessmentParentId(snapshot)
  if (parentId) {
    const [parent] = await tx
      .select({ locked: hazidAssessments.locked })
      .from(hazidAssessments)
      .where(
        and(
          eq(hazidAssessments.tenantId, tenantId),
          eq(hazidAssessments.id, parentId),
          isNull(hazidAssessments.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (!parent) {
      throw new FormResponseParentIntegrityError(
        'Hazard-assessment response points to a missing parent assessment.',
      )
    }
    if (parent.locked) throw new FormResponseParentLockedError()
  }

  const [response] = await tx
    .select()
    .from(formResponses)
    .where(
      and(
        eq(formResponses.tenantId, tenantId),
        eq(formResponses.id, responseId),
        isNull(formResponses.deletedAt),
      ),
    )
    .limit(1)
    .for('update')
  if (!response) return null
  if (
    response.sourceEntityType !== snapshot.sourceEntityType ||
    response.sourceEntityId !== snapshot.sourceEntityId
  ) {
    throw new FormResponseParentIntegrityError(
      'Form response source changed concurrently; retry the operation.',
    )
  }
  return response
}

export function isFormResponseParentLockedError(
  error: unknown,
): error is FormResponseParentLockedError {
  return error instanceof FormResponseParentLockedError
}
