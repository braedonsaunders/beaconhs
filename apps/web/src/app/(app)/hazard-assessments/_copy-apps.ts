import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  formResponses,
  formTemplates,
  formTemplateVersions,
  hazidAssessmentAppResponses,
} from '@beaconhs/db/schema'
import { canAccessTemplate } from '@/app/(app)/apps/_lib/access'
import { responsePayload } from '@/app/(app)/apps/_lib/response-payload'
import { getEffectiveRoleKeys } from '@/lib/effective-roles'
import { dateIsoInTimeZone } from '@/lib/datetime'
import { copyHazidAppPayload } from '@/lib/hazid-copy-payload'
import type { HazidAssessmentRow, HazidCtx } from './_assessment-rules'
import type { AttachmentCopier } from '@/lib/copy-attachments'

export async function copyAssessmentApps(
  tx: Database,
  ctx: HazidCtx,
  sourceId: string,
  copy: HazidAssessmentRow,
  includePhotos: boolean,
  files: AttachmentCopier,
) {
  const linked = await tx
    .select({
      link: hazidAssessmentAppResponses,
      response: formResponses,
      template: formTemplates,
      schema: formTemplateVersions.schema,
    })
    .from(hazidAssessmentAppResponses)
    .innerJoin(formResponses, eq(formResponses.id, hazidAssessmentAppResponses.responseId))
    .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
    .innerJoin(formTemplateVersions, eq(formTemplateVersions.id, formResponses.templateVersionId))
    .where(
      and(eq(hazidAssessmentAppResponses.assessmentId, sourceId), isNull(formResponses.deletedAt)),
    )
    .orderBy(asc(hazidAssessmentAppResponses.entityOrder), asc(hazidAssessmentAppResponses.id))
    .for('update', { of: formResponses })
  const roles = await getEffectiveRoleKeys(ctx, tx)
  for (const app of linked) {
    if (!canAccessTemplate(ctx, app.template, roles, 'operate')) {
      throw new Error(
        `Cannot copy the attached plan "${app.template.name}" with your current access. Ask an administrator to restore access before copying.`,
      )
    }
    // Copies always land on the latest published version so template fixes
    // reach copied assessments (field ids are stable across versions). Fall
    // back to the source version only when nothing is published.
    const [latest] = await tx
      .select({ id: formTemplateVersions.id, schema: formTemplateVersions.schema })
      .from(formTemplateVersions)
      .where(
        and(
          eq(formTemplateVersions.templateId, app.response.templateId),
          isNotNull(formTemplateVersions.publishedAt),
        ),
      )
      .orderBy(desc(formTemplateVersions.version))
      .limit(1)
    const copiedPayload = copyHazidAppPayload(
      latest?.schema ?? app.schema,
      responsePayload(
        app.response.data,
        app.response.status === 'draft' || app.response.status === 'in_progress'
          ? app.response.draftData
          : null,
      ),
      {
        templateKey: app.template.key,
        date: dateIsoInTimeZone(copy.occurredAt, ctx.timezone),
        includePhotos,
      },
    )
    const data = await files.payload(tx, copiedPayload)
    const copiedData =
      app.response.captureMode === 'external' ? { ...data, __externalPhotoIds: [] } : data
    const [response] = await tx
      .insert(formResponses)
      .values({
        tenantId: ctx.tenantId,
        templateId: app.response.templateId,
        templateVersionId: latest?.id ?? app.response.templateVersionId,
        captureMode: app.response.captureMode,
        externalReference:
          app.response.captureMode === 'external' ? copy.reference : app.response.externalReference,
        externalIssuer: app.response.externalIssuer,
        externalNotes: app.response.externalNotes,
        status: app.response.captureMode === 'external' ? 'submitted' : 'draft',
        submittedAt: app.response.captureMode === 'external' ? new Date() : null,
        submittedBy: ctx.membership?.id ?? null,
        siteOrgUnitId: copy.siteOrgUnitId,
        subjectPersonId: app.response.subjectPersonId,
        data: copiedData,
        sourceEntityType: 'hazid_assessment',
        sourceEntityId: copy.id,
      })
      .returning({ id: formResponses.id })
    if (!response) throw new Error('Could not copy the attached plan')
    await tx.insert(hazidAssessmentAppResponses).values({
      tenantId: ctx.tenantId,
      assessmentId: copy.id,
      typeAppId: app.link.typeAppId,
      templateId: app.link.templateId,
      responseId: response.id,
      entityOrder: app.link.entityOrder,
    })
  }
}
