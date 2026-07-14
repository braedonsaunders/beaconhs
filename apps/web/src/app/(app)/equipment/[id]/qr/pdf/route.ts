import { NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { equipmentItems, tenants } from '@beaconhs/db/schema'
import { renderDesignDocumentsPdf } from '@beaconhs/forms-pdf'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
import { loadEquipmentLabelData } from '@/lib/equipment-label-data'
import { normalizeEquipmentLabelDesign } from '@/lib/equipment-label-design'
import { pdfBufferResponse } from '@/lib/pdf-route'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

/** One equipment QR label as a print-ready PDF at the tenant's label size. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const ctx = await requireRequestContext()

  const result = await ctx.db(async (tx) => {
    const [item] = await tx
      .select({
        siteId: equipmentItems.currentSiteOrgUnitId,
        personId: equipmentItems.currentHolderPersonId,
      })
      .from(equipmentItems)
      .where(and(eq(equipmentItems.id, id), isNull(equipmentItems.deletedAt)))
      .limit(1)
    if (!item) return null
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'equipment',
      siteId: item.siteId,
      personId: item.personId,
    })
    if (!visible) return null
    const [t] = await tx
      .select({ settings: tenants.settings, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
    // Visibility was checked above, so no extra scope predicate is needed.
    const labels = await loadEquipmentLabelData(tx, t?.name ?? 'BeaconHS', [id], undefined)
    return { document: normalizeEquipmentLabelDesign(t?.settings ?? {}), labels }
  })
  if (!result || result.labels.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const pdf = await renderDesignDocumentsPdf(
    result.labels.map((data) => ({ document: result.document, data })),
    { title: 'Equipment QR label' },
  )
  await recordAudit(ctx, {
    entityType: 'equipment',
    entityId: id,
    action: 'export',
    summary: 'Downloaded the equipment QR label PDF',
  })
  return pdfBufferResponse(pdf, `equipment-label-${result.labels[0]!.equipmentAssetTag || id}.pdf`)
}
