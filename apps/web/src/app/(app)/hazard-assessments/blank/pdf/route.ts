// GET /hazard-assessments/blank/pdf?typeId=…
//
// A BLANK assessment for on-site handwriting: the chosen type's real hazards,
// PPE and questions with every answer column empty. Renders through the same
// template chain as a real record, using the tenant's blank hazid template.

import { renderTemplate } from '@beaconhs/email-render'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { buildBlankHazidValues, HAZID_BLANK_TEMPLATE_KEY } from '@/lib/hazid-blank-print'
import { getModuleTemplateByKey } from '@/lib/pdf-templates'
import { renderOnDemandPdfResponse } from '@/lib/pdf-route'
import { isRouterPrefetch } from '@/lib/router-prefetch'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  if (isRouterPrefetch(request)) return new Response(null, { status: 204 })

  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return Response.json({ error: 'No active tenant' }, { status: 400 })
  // Printing a blank is preparing to run one.
  assertCan(ctx, 'hazid.create')

  const typeId = new URL(request.url).searchParams.get('typeId')
  if (typeId && !isUuid(typeId)) return Response.json({ error: 'Not found' }, { status: 404 })

  const values = await buildBlankHazidValues(ctx, typeId)
  if (!values) return Response.json({ error: 'Assessment type not found' }, { status: 404 })

  const tpl = await getModuleTemplateByKey(ctx, 'hazid', HAZID_BLANK_TEMPLATE_KEY)
  if (!tpl) {
    return Response.json(
      { error: 'No blank hazard assessment template is set up for this workspace.' },
      { status: 409 },
    )
  }

  const headerVals = { ...values, page: '{{page}}', pages: '{{pages}}' }
  const response = await renderOnDemandPdfResponse({
    kind: 'template_pdf',
    tenantId: ctx.tenantId,
    html: renderTemplate(tpl.compiledHtml, values, { escapeHtml: true }),
    paperSize: tpl.paperSize,
    orientation: tpl.orientation,
    marginMm: tpl.marginMm,
    headerHtml: tpl.headerHtml
      ? renderTemplate(tpl.headerHtml, headerVals, { escapeHtml: false })
      : null,
    footerHtml: tpl.footerHtml
      ? renderTemplate(tpl.footerHtml, headerVals, { escapeHtml: false })
      : null,
    entityType: 'hazid_assessment',
    entityId: ctx.tenantId,
    filename: 'hazard-assessment-blank.pdf',
  })
  if (response.ok) {
    await recordAudit(ctx, {
      entityType: 'hazid_assessment',
      entityId: undefined,
      action: 'export',
      summary: 'Printed a blank hazard assessment',
      metadata: { format: 'pdf', typeId },
    })
  }
  return response
}
