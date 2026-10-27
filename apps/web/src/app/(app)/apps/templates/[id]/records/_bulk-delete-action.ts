'use server'

import { redirect } from 'next/navigation'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { can } from '@beaconhs/tenant'
import { domainEventActor, recordDomainEvent } from '@beaconhs/events'
import { formResponses } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@beaconhs/tenant/visibility'
import { recordAuditInTransaction } from '@/lib/audit'
import { archiveFormResponseInTransaction } from '@/lib/forms/archive-form-response'
import { canDeleteOwnRecord } from '@/lib/record-delete-policy'
import { isUuid } from '@/lib/list-params'

export async function bulkDeleteBuilderResponses(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const templateId = String(formData.get('templateId') ?? '')
  const ids = [...new Set(formData.getAll('responseId').map(String))]
  if (
    !isUuid(templateId) ||
    ids.length === 0 ||
    ids.length > 100 ||
    ids.some((id) => !isUuid(id))
  ) {
    throw new Error('Select up to 100 valid responses')
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
    if (rows.length !== ids.length) throw new Error('One or more responses are no longer available')
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
        throw new Error('You do not have permission to delete every selected response')
      if (response.locked) throw new Error('Locked responses cannot be deleted')
    }
    for (const response of rows) {
      const archived = await archiveFormResponseInTransaction(tx, ctx, response.id, templateId)
      if (!archived) throw new Error('A selected response changed before it could be deleted')
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
  redirect(`/apps/templates/${templateId}/records`)
}
