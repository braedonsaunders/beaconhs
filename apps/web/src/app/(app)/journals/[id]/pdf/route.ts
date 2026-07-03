// GET /journals/:id/pdf
//
// Render a journal entry PDF on demand. Uses the tenant's configured template
// for the journals module when one is set, else the generic record summary.

import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { renderModulePdfResponse } from '@/lib/module-pdf'
import { getEntry } from '../../_data'

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

  // Read-scope the PDF exactly like the HTML page + /print route: getEntry
  // applies journalScopeWhere, so a journals.read.self user can't fetch another
  // author's journal by id. The renderer below loads by id under RLS only, which
  // would otherwise leak the whole tenant to a self-scoped reader.
  const entry = await getEntry(ctx, id)
  if (!entry) return new Response('Not found', { status: 404 })

  await recordAudit(ctx, {
    entityType: 'journal_entry',
    entityId: id,
    action: 'export',
    summary: 'Exported PDF',
    metadata: { format: 'pdf' },
  })

  return renderModulePdfResponse(ctx, { moduleKey: 'journals', recordId: id })
}
