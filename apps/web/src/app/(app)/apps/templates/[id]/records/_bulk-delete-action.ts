'use server'

import { revalidatePath } from 'next/cache'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { can } from '@beaconhs/tenant'
import { domainEventActor, recordDomainEvent } from '@beaconhs/events'
import { formResponses } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@beaconhs/tenant/visibility'
import { recordAuditInTransaction } from '@/lib/audit'
import {
  archiveFormResponseInTransaction,
  FormResponseLockedError,
} from '@/lib/forms/archive-form-response'
import { canDeleteOwnRecord } from '@/lib/own-record-policy'
import { isUuid } from '@/lib/list-params'
import { canAccessTemplateById } from '@/app/(app)/apps/_lib/access'

class BulkDeleteError extends Error {}

/**
 * Archive the selected records of one app. All or nothing: any record the
 * caller may not delete, or that is locked, refuses the whole batch. Failures
 * are returned rather than thrown — production hides thrown server-action
 * messages.
 */
export async function bulkDeleteBuilderResponses(input: {
  templateId: string
  responseIds: string[]
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  const templateId = String(input.templateId ?? '')
  const ids = [...new Set((Array.isArray(input.responseIds) ? input.responseIds : []).map(String))]
  if (
    !isUuid(templateId) ||
    ids.length === 0 ||
    ids.length > 100 ||
    ids.some((id) => !isUuid(id))
  ) {
    return { ok: false, error: 'Select up to 100 records to delete.' }
  }
  try {
    if (!(await canAccessTemplateById(ctx, templateId, 'browse-records'))) {
      return { ok: false, error: 'This app is no longer available.' }
    }
    await ctx.db(async (tx) => {
      const rows = await tx
        .select()
        .from(formResponses)
        .where(
          and(
            eq(formResponses.templateId, templateId),
            inArray(formResponses.id, ids),
            isNull(formResponses.deletedAt),
          ),
        )
        .orderBy(asc(formResponses.id))
      if (rows.length !== ids.length)
        throw new BulkDeleteError('One or more responses are no longer available')
      for (const response of rows) {
        const permitted =
          can(ctx, 'forms.response.delete') ||
          canDeleteOwnRecord(ctx, 'forms.response.delete.own', response.submittedBy)
        if (
          !permitted ||
          !(await canSeeRecord(ctx, tx, {
            prefix: 'forms.response',
            ownerIds: [response.submittedBy],
            personId: response.subjectPersonId,
            siteId: response.siteOrgUnitId,
          }))
        )
          throw new BulkDeleteError('You do not have permission to delete every selected response')
        if (response.locked) throw new FormResponseLockedError('Locked responses cannot be deleted')
      }
      for (const response of rows) {
        const archived = await archiveFormResponseInTransaction(tx, ctx, response.id, templateId)
        if (!archived) {
          throw new BulkDeleteError('A selected response changed before it could be deleted')
        }
        await recordAuditInTransaction(tx, ctx, {
          entityType: 'form_response',
          entityId: response.id,
          action: 'delete',
          summary: 'Deleted Builder response',
          before: { status: response.status, submittedAt: response.submittedAt },
          after: { deletedAt: archived.deletedAt },
        })
        await recordDomainEvent(tx, {
          tenantId: ctx.tenantId!,
          eventType: 'form.deleted',
          subjectId: response.id,
          dedupKey: `form.deleted:${response.id}:${archived.deletedAt.toISOString()}`,
          payload: {
            web: {
              kind: 'form_deleted',
              subjectId: response.id,
              templateId,
              data: {
                ...((response.data ?? {}) as Record<string, unknown>),
                capture_mode: response.captureMode,
                external_reference: response.externalReference,
                external_issuer: response.externalIssuer,
              },
              actor: domainEventActor(ctx),
            },
          },
        })
      }
    })
  } catch (error) {
    if (error instanceof BulkDeleteError || error instanceof FormResponseLockedError) {
      return { ok: false, error: error.message }
    }
    console.error('[builder] bulk response deletion failed', error)
    return { ok: false, error: 'The records could not be deleted. Try again.' }
  }
  revalidatePath(`/apps/templates/${templateId}/records`)
  return { ok: true }
}
