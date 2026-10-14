// GET /reports/briefs/:id/runs/:runId/pdf
//
// Scheduled and "Run now" briefs stream the PDF stored with the run — exactly
// what recipients received. Previews and API runs render on demand from the
// stored result.

import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { tenants } from '@beaconhs/db/schema'
import { escapeHtml, renderBriefPdfBody } from '@beaconhs/briefs'
import { resolveTenantLogoUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { appBaseUrl } from '@/lib/app-base-url'
import { canReadBriefs } from '@/lib/briefs/access'
import { loadBriefRun } from '@/lib/briefs/data'
import { isUuid } from '@/lib/list-params'
import { renderOnDemandPdfResponse, storedPdfArtifactResponse } from '@/lib/pdf-route'
import { isRouterPrefetch } from '@/lib/router-prefetch'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
): Promise<Response> {
  if (isRouterPrefetch(request)) return new Response(null, { status: 204 })
  const { id, runId } = await params
  if (!isUuid(id) || !isUuid(runId)) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }
  const ctx = await requireRequestContext()
  if (!canReadBriefs(ctx)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const row = await loadBriefRun(ctx, id, runId)
  if (!row) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  const { run } = row
  if (!run.result || !run.evidence) {
    return NextResponse.json(
      { error: 'This brief has no result yet', status: run.status },
      { status: 404 },
    )
  }

  let response: Response
  if (row.pdf?.id) {
    response = await storedPdfArtifactResponse({ r2Key: row.pdf.r2Key, filename: row.pdf.filename })
  } else {
    const [tenant] = await ctx.db((tx) =>
      tx
        .select({ name: tenants.name, branding: tenants.branding })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1),
    )
    const html = renderBriefPdfBody({
      briefName: run.briefName,
      tenantName: tenant?.name ?? '',
      logoUrl: tenant
        ? await resolveTenantLogoUrl({ tenantId: ctx.tenantId, logoUrl: tenant.branding.logoUrl })
        : null,
      accentColor: tenant?.branding.primaryColor ?? null,
      result: run.result,
      evidence: run.evidence,
      appUrl: appBaseUrl(),
      runPath: `/reports/briefs/${id}/runs/${runId}`,
      generatedAt: run.finishedAt ?? run.createdAt,
      modelLabel: run.aiMeta?.model ?? null,
    })
    response = await renderOnDemandPdfResponse({
      kind: 'template_pdf',
      tenantId: ctx.tenantId,
      html,
      paperSize: 'letter',
      orientation: 'portrait',
      marginMm: 10,
      footerHtml: `${escapeHtml(run.briefName)} · ${escapeHtml(run.windowLabel)} · Page {{page}} of {{pages}}`,
      entityType: 'brief_run',
      entityId: run.id,
      filename: `${run.briefName.replace(/[^\w.-]+/g, '-').slice(0, 60)}.pdf`,
    })
  }
  if (response.ok) {
    await recordAudit(ctx, {
      entityType: 'brief_run',
      entityId: run.id,
      action: 'export',
      summary: `Downloaded AI brief PDF "${run.briefName}"`,
      metadata: { format: 'pdf', briefId: id },
    })
  }
  return response
}
