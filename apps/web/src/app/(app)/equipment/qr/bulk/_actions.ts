'use server'

// Bulk-QR sheet generation. Stamping the traceable bulk-QR token and writing
// the export audit are mutations, so they live here (a POSTed server action)
// instead of in the print page's GET render — refreshing or restoring the
// print tab must never re-stamp rows or write phantom audit rows.

import { randomBytes } from 'crypto'
import { redirect } from 'next/navigation'
import { and, inArray, isNull } from 'drizzle-orm'
import { equipmentItems } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'

const MAX_SHEET = 500

export async function generateBulkQrSheet(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.read.site')

  const requestedIds = formData
    .getAll('ids')
    .flatMap((v) => String(v).split(','))
    .map((s) => s.trim())
    .filter(Boolean)
  if (
    requestedIds.length === 0 ||
    requestedIds.length > MAX_SHEET ||
    requestedIds.some((id) => !isUuid(id))
  ) {
    redirect('/equipment/qr/bulk?error=invalid-selection')
  }
  const ids = Array.from(new Set(requestedIds))

  const bulkToken = randomBytes(8).toString('base64url')

  const stampedIds = await ctx.db(async (tx) => {
    const scope = await moduleScopeWhere(ctx, tx, {
      prefix: 'equipment',
      siteCol: equipmentItems.currentSiteOrgUnitId,
      personCol: equipmentItems.currentHolderPersonId,
    })
    const rows = await tx
      .select({ id: equipmentItems.id })
      .from(equipmentItems)
      .where(
        and(
          inArray(equipmentItems.id, ids),
          isNull(equipmentItems.deletedAt),
          ...(scope ? [scope] : []),
        ),
      )
    if (rows.length === 0) return []
    // Stamp the bulk-QR token + timestamp so re-printing a sheet can be traced
    // back through the audit log.
    await tx
      .update(equipmentItems)
      .set({ bulkQrToken: bulkToken, bulkQrGeneratedAt: new Date() })
      .where(
        inArray(
          equipmentItems.id,
          rows.map((r) => r.id),
        ),
      )
    return rows.map((r) => r.id)
  })

  if (stampedIds.length === 0) redirect('/equipment/qr/bulk')

  await recordAudit(ctx, {
    entityType: 'equipment',
    action: 'export',
    summary: `Generated bulk QR sheet for ${stampedIds.length} item${stampedIds.length === 1 ? '' : 's'}`,
    metadata: { bulkToken, itemIds: stampedIds },
  })

  redirect(`/equipment/qr/labels?ids=${stampedIds.join(',')}&token=${bulkToken}`)
}
