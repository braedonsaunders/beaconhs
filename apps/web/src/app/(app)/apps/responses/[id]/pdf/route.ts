// GET /apps/responses/:id/pdf
//
// Render a fresh form-response PDF on demand and stream it back to the browser.

import { notFound } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { formResponses } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
import { renderFormResponsePdfResponse } from '@/lib/module-pdf'
import { recordAudit } from '@/lib/audit'
import { canAccessResponseTemplate } from '../../../_lib/access'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) {
    return Response.json({ error: 'No active tenant' }, { status: 400 })
  }
  if (!(await canAccessResponseTemplate(ctx, id, 'browse-records'))) notFound()

  // Per-user record visibility — mirror the HTML detail page so the PDF can't be
  // pulled for a response the caller isn't allowed to see (read.all → any;
  // read.site → my sites; else → ones I submitted or am the subject of).
  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .select({
        submittedBy: formResponses.submittedBy,
        subjectPersonId: formResponses.subjectPersonId,
        siteOrgUnitId: formResponses.siteOrgUnitId,
      })
      .from(formResponses)
      .where(and(eq(formResponses.id, id), isNull(formResponses.deletedAt)))
      .limit(1)
    return r ?? null
  })
  if (!row) notFound()
  if (
    !(await ctx.db((tx) =>
      canSeeRecord(ctx, tx, {
        prefix: 'forms.response',
        ownerIds: [row.submittedBy],
        personId: row.subjectPersonId,
        siteId: row.siteOrgUnitId,
      }),
    ))
  ) {
    notFound()
  }

  const response = await renderFormResponsePdfResponse(ctx, id)
  if (response.ok) {
    await recordAudit(ctx, {
      entityType: 'form_response',
      entityId: id,
      action: 'export',
      summary: 'Exported form response to PDF',
      metadata: { format: 'pdf' },
    })
  }
  return response
}
