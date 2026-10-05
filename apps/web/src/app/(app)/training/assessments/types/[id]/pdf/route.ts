import { and, asc, eq, isNull } from 'drizzle-orm'
import { trainingAssessmentTypeQuestions, trainingAssessmentTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { isRouterPrefetch } from '@/lib/router-prefetch'
import { renderOnDemandPdfResponse } from '@/lib/pdf-route'
import { buildBlankTrainingAssessmentHtml } from '@/lib/training-assessment-blank-pdf'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (isRouterPrefetch(request)) return new Response(null, { status: 204 })
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const data = await ctx.db(async (tx) => {
    const [type] = await tx
      .select()
      .from(trainingAssessmentTypes)
      .where(and(eq(trainingAssessmentTypes.id, id), isNull(trainingAssessmentTypes.deletedAt)))
      .limit(1)
    if (!type) return null
    const questions = await tx
      .select({
        prompt: trainingAssessmentTypeQuestions.prompt,
        kind: trainingAssessmentTypeQuestions.kind,
        options: trainingAssessmentTypeQuestions.options,
        helpText: trainingAssessmentTypeQuestions.helpText,
        mandatory: trainingAssessmentTypeQuestions.mandatory,
      })
      .from(trainingAssessmentTypeQuestions)
      .where(eq(trainingAssessmentTypeQuestions.typeId, id))
      .orderBy(
        asc(trainingAssessmentTypeQuestions.entityOrder),
        asc(trainingAssessmentTypeQuestions.id),
      )
    return { type, questions }
  })
  if (!data) return Response.json({ error: 'Not found' }, { status: 404 })
  if (!data.questions.length)
    return Response.json({ error: 'Add at least one question before printing.' }, { status: 409 })
  const response = await renderOnDemandPdfResponse({
    kind: 'template_pdf',
    tenantId: ctx.tenantId,
    html: buildBlankTrainingAssessmentHtml(data.type, data.questions),
    paperSize: 'letter',
    orientation: 'portrait',
    marginMm: 14,
    entityType: 'training_assessment_type',
    entityId: id,
    filename: `assessment-${id.slice(0, 8)}-blank.pdf`,
  })
  if (response.ok)
    await recordAudit(ctx, {
      entityType: 'training_assessment_type',
      entityId: id,
      action: 'export',
      summary: 'Printed blank training assessment',
      metadata: { format: 'pdf', blank: true },
    })
  return response
}
