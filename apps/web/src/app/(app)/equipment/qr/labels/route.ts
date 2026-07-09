import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { equipmentItems, tenants } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { renderDesignDocumentsPdf } from '@beaconhs/forms-pdf'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { loadEquipmentLabelData } from '@/lib/equipment-label-data'
import { normalizeEquipmentLabelDesign } from '@/lib/equipment-label-design'
import { pdfBufferResponse } from '@/lib/pdf-route'

export const dynamic = 'force-dynamic'

const MAX_LABELS = 500

/**
 * Bulk equipment QR labels — one PDF, one label page per item, at the
 * tenant's designed label size (thermal/shipping label printers print each
 * page as one tag). The picker's server action stamps the traceable bulk-QR
 * token + export audit before redirecting here, so this GET stays read-only.
 */
export async function GET(req: Request) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.read.site')

  const url = new URL(req.url)
  const ids = (url.searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_LABELS)
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No equipment selected' }, { status: 400 })
  }

  const result = await ctx.db(async (tx) => {
    const scope = await moduleScopeWhere(ctx, tx, {
      prefix: 'equipment',
      siteCol: equipmentItems.currentSiteOrgUnitId,
      personCol: equipmentItems.currentHolderPersonId,
    })
    const [t] = await tx
      .select({ settings: tenants.settings, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
    const labels = await loadEquipmentLabelData(tx, t?.name ?? 'BeaconHS', ids, scope)
    return { document: normalizeEquipmentLabelDesign(t?.settings ?? {}), labels }
  })
  if (result.labels.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const pdf = await renderDesignDocumentsPdf(
    result.labels.map((data) => ({ document: result.document, data })),
    { title: 'Equipment QR labels' },
  )
  return pdfBufferResponse(pdf, `equipment-labels-${result.labels.length}.pdf`)
}
