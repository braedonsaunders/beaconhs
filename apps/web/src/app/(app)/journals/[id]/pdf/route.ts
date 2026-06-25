// GET /journals/:id/pdf
//
// Render a journal entry PDF on demand. Uses the tenant's configured template
// for the journals module when one is set, else the generic record summary.

import { requireRequestContext } from '@/lib/auth'
import { renderModulePdfResponse } from '@/lib/module-pdf'

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

  return renderModulePdfResponse(ctx, { moduleKey: 'journals', recordId: id })
}
