// GET /people/:id/badge — the person's printable ID badge (two-sided CR80 PDF,
// rendered on demand from the tenant's badge design so design changes apply
// instantly). Printing issues the person's stable badge token on first use;
// the badge QR opens their public live training transcript.

import { NextResponse, type NextRequest } from 'next/server'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { renderPersonBadgePdf } from '@/lib/person-badge'
import { pdfResponse } from '@/lib/training-credential-pdf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: personId } = await params
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) {
    return NextResponse.json({ error: 'No active tenant' }, { status: 400 })
  }
  assertCanManageModule(ctx, 'people')

  const rendered = await renderPersonBadgePdf(ctx, personId)
  if (!rendered) {
    return NextResponse.json({ error: 'Person not found.' }, { status: 404 })
  }

  await recordAudit(ctx, {
    entityType: 'person_badge',
    entityId: personId,
    action: 'export',
    summary: 'Printed an ID badge',
  })
  return pdfResponse(rendered)
}
