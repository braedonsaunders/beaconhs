import 'server-only'

import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  formResponses,
  formTemplates,
  hazidAssessmentAppResponses,
  hazidAssessmentQuestions,
  hazidAssessmentTypeApps,
  hazidAssessments,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import type { PdfJobData } from '@beaconhs/jobs'
import { escapeHtml } from '@beaconhs/email-render'
import { createFormFlowAdapter } from '@/app/(app)/apps/_lib/form-flow-adapter'
import { canAccessTemplate } from '@/app/(app)/apps/_lib/access'
import { getEffectiveRoleKeys } from './effective-roles'
import { hazidAppIsApplicable } from './hazid-app-condition'
import { getFormTemplateDefaultTemplate } from './pdf-templates'
import { buildSummaryPdfPart, buildTemplatePdfPart } from './flows/pdf-document'
import { buildRecordSummaryPdfJob } from './flows/pdf-summary'

export async function loadHazidPdfAppendices(
  ctx: RequestContext,
  assessmentId: string,
): Promise<Extract<PdfJobData, { kind: 'document_bundle' }>['parts']> {
  const roles = await getEffectiveRoleKeys(ctx)
  const apps = await ctx.db(async (tx) => {
    const [assessment] = await tx
      .select({ typeId: hazidAssessments.assessmentTypeId })
      .from(hazidAssessments)
      .where(and(eq(hazidAssessments.id, assessmentId), isNull(hazidAssessments.deletedAt)))
      .limit(1)
    if (!assessment?.typeId) return []
    const questions = await tx
      .select()
      .from(hazidAssessmentQuestions)
      .where(eq(hazidAssessmentQuestions.assessmentId, assessmentId))
    const answers = new Map(
      questions.flatMap((question) =>
        question.sourceTypeQuestionId
          ? [[question.sourceTypeQuestionId, question.answer] as const]
          : [],
      ),
    )
    const rows = await tx
      .select({
        app: hazidAssessmentTypeApps,
        template: formTemplates,
        name: formTemplates.name,
        responseId: formResponses.id,
        status: formResponses.status,
        captureMode: formResponses.captureMode,
        externalReference: formResponses.externalReference,
        externalIssuer: formResponses.externalIssuer,
        externalNotes: formResponses.externalNotes,
        responseData: formResponses.data,
      })
      .from(hazidAssessmentTypeApps)
      .innerJoin(formTemplates, eq(formTemplates.id, hazidAssessmentTypeApps.templateId))
      .leftJoin(
        hazidAssessmentAppResponses,
        and(
          eq(hazidAssessmentAppResponses.typeAppId, hazidAssessmentTypeApps.id),
          eq(hazidAssessmentAppResponses.assessmentId, assessmentId),
        ),
      )
      .leftJoin(
        formResponses,
        and(
          eq(formResponses.id, hazidAssessmentAppResponses.responseId),
          isNull(formResponses.deletedAt),
        ),
      )
      .where(
        and(
          eq(hazidAssessmentTypeApps.typeId, assessment.typeId),
          isNull(hazidAssessmentTypeApps.deletedAt),
        ),
      )
      .orderBy(asc(hazidAssessmentTypeApps.entityOrder), asc(hazidAssessmentTypeApps.id))
    return rows.filter(({ app }) => hazidAppIsApplicable(app.config, answers))
  })
  const parts: Extract<PdfJobData, { kind: 'document_bundle' }>['parts'] = []
  for (const app of apps) {
    if (!canAccessTemplate(ctx, app.template, roles, 'browse-records')) {
      throw new Error(
        'An attached plan cannot be exported with your current access. Ask an administrator to review the plan permissions.',
      )
    }
    const status =
      app.status === 'submitted'
        ? 'Submitted'
        : app.status === 'non_compliant'
          ? 'Submitted — non-compliant'
          : app.status === 'closed'
            ? 'Closed'
            : app.status === 'in_review'
              ? 'In review'
              : app.status === 'rejected'
                ? 'Rejected — review this plan'
                : app.responseId
                  ? 'DRAFT — review and submit this plan'
                  : 'NOT STARTED — this plan has not been completed'
    const values =
      app.responseId && app.captureMode !== 'external'
        ? await createFormFlowAdapter(ctx, app.responseId).loadValues()
        : {}
    const template =
      app.responseId && app.captureMode !== 'external'
        ? await getFormTemplateDefaultTemplate(ctx, app.app.templateId)
        : null
    const part = template
      ? buildTemplatePdfPart(template, values)
      : buildSummaryPdfPart(
          buildRecordSummaryPdfJob({
            tenantId: ctx.tenantId,
            subjectId: app.responseId ?? assessmentId,
            entityType: 'form_response',
            heading: app.name,
            values,
          }),
        )
    if (app.captureMode === 'external') part.html = ''
    // A custom plan template may have no status field. Always label draft plans.
    const externalSummary =
      app.captureMode === 'external'
        ? `<div style="font-family:Arial,sans-serif;border:1px solid #cbd5e1;padding:10px;margin:10px 0"><strong>External form</strong><br/>Ref ${escapeHtml(app.externalReference || '')}<br/>Issuer ${escapeHtml(app.externalIssuer || '')}<br/>Photos ${Array.isArray((app.responseData as Record<string, unknown> | null)?.__externalPhotoIds) ? ((app.responseData as Record<string, unknown>).__externalPhotoIds as unknown[]).length : 0}${app.externalNotes ? `<br/>Notes ${escapeHtml(app.externalNotes)}` : ''}</div>`
        : ''
    part.html = `<div style="font-family:Arial,sans-serif;border-bottom:1px solid #94a3b8;padding:0 0 8px;margin:0 0 12px;break-after:avoid"><strong>${escapeHtml(app.app.label || app.name)}</strong><br/>${escapeHtml(status)}</div>${externalSummary}${part.html}`
    parts.push(part)
  }
  return parts
}
