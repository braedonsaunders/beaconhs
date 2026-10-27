'use server'

import { redirect } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { can } from '@beaconhs/tenant'
import { domainEventActor, recordDomainEvent } from '@beaconhs/events'
import { formResponses } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@beaconhs/tenant/visibility'
import { recordAuditInTransaction } from '@/lib/audit'
import { archiveFormResponseInTransaction } from '@/lib/forms/archive-form-response'
import { canDeleteOwnRecord } from '@/lib/record-delete-policy'
import { canAccessResponseTemplate } from '@/app/(app)/apps/_lib/access'
import { isUuid } from '@/lib/list-params'

export async function deleteFormResponse(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!isUuid(id)) throw new Error('Invalid response')
  if (!(await canAccessResponseTemplate(ctx, id, 'browse-records')))
    throw new Error('Response not found')
  const templateId = await ctx.db(async (tx) => {
    const [response] = await tx
      .select()
      .from(formResponses)
      .where(and(eq(formResponses.id, id), isNull(formResponses.deletedAt)))
      .limit(1)
    if (!response) throw new Error('Response not found')
    const allowed =
      can(ctx, 'forms.response.delete') ||
      canDeleteOwnRecord(ctx, 'forms.response.delete.own', response.submittedBy)
    if (!allowed) throw new Error('You do not have permission to delete this response')
    if (
      !(await canSeeRecord(ctx, tx, {
        prefix: 'forms.response',
        ownerIds: [response.submittedBy],
        personId: response.subjectPersonId,
        siteId: response.siteOrgUnitId,
      }))
    )
      throw new Error('Response not found')
    const archived = await archiveFormResponseInTransaction(tx, ctx, id)
    if (!archived) throw new Error('Response not found')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'form_response',
      entityId: id,
      action: 'delete',
      summary: 'Deleted Builder response',
      before: { status: archived.before.status, submittedAt: archived.before.submittedAt },
      after: { deletedAt: archived.deletedAt },
    })
    await recordDomainEvent(tx, {
      tenantId: ctx.tenantId!,
      eventType: 'form.deleted',
      subjectId: id,
      dedupKey: `form.deleted:${id}:${archived.deletedAt.toISOString()}`,
      payload: {
        web: {
          kind: 'form_deleted',
          subjectId: id,
          templateId: response.templateId,
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
    return response.templateId
  })
  redirect(`/apps/templates/${templateId}/records`)
}
