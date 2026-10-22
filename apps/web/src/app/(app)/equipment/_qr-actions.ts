'use server'

// Creating a sheet stamps its token and records the export once. Downloading
// the resulting PDF is read-only, so retries never write phantom audit rows.
import { randomBytes } from 'node:crypto'
import { and, inArray, isNull } from 'drizzle-orm'
import { equipmentItems } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@beaconhs/tenant/visibility'
import { recordAuditInTransaction } from '@/lib/audit'
import { parseBulkActionIds } from '@/lib/bulk-actions'

type BulkQrResult = { ok: true; href: string; count: number } | { ok: false; error: string }

export async function generateBulkQrSheet(args: { equipmentIds: string[] }): Promise<BulkQrResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.read.site')
  const parsed = parseBulkActionIds(args?.equipmentIds, {
    singular: 'equipment item',
    plural: 'equipment items',
  })
  if (!parsed.ok) return parsed
  const ids = parsed.ids
  const bulkToken = randomBytes(8).toString('base64url')

  return ctx.db<BulkQrResult>(async (tx) => {
    const scope = await moduleScopeWhere(ctx, tx, {
      prefix: 'equipment',
      siteCol: equipmentItems.currentSiteOrgUnitId,
      personCol: equipmentItems.currentHolderPersonId,
    })
    const rows = await tx
      .select({ id: equipmentItems.id })
      .from(equipmentItems)
      .where(and(inArray(equipmentItems.id, ids), isNull(equipmentItems.deletedAt), scope))
      .for('update')
    if (rows.length !== ids.length) {
      return {
        ok: false,
        error: 'Some selected equipment is unavailable. Refresh the list and select again.',
      }
    }
    await tx
      .update(equipmentItems)
      .set({ bulkQrToken: bulkToken, bulkQrGeneratedAt: new Date() })
      .where(inArray(equipmentItems.id, ids))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment',
      action: 'export',
      summary: `Generated bulk QR sheet for ${ids.length} item${ids.length === 1 ? '' : 's'}`,
      metadata: { bulkToken, itemIds: ids },
    })
    return {
      ok: true,
      href: `/equipment/qr/labels?ids=${ids.join(',')}&token=${bulkToken}`,
      count: ids.length,
    }
  })
}
