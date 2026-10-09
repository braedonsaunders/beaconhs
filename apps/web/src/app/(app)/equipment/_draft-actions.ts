'use server'

import { revalidatePath } from 'next/cache'
import { randomBytes } from 'crypto'
import { eq, sql } from 'drizzle-orm'
import { equipmentItems } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { requireUuidInput } from '@/lib/mutation-input'
import { recordAuditInTransaction } from '@/lib/audit'

/** Start one draft per creation request and open the full record immediately. */
export async function createEquipmentDraft(
  requestId: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const id = requireUuidInput(requestId, 'Creation request')
  const qrToken = randomBytes(12).toString('base64url')
  const assetTag = `DRAFT-${randomBytes(3).toString('hex').toUpperCase()}`
  const itemId = await ctx.db(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${ctx.tenantId} || ':equipment-create:' || ${id}))`,
    )
    const [existing] = await tx
      .select({ id: equipmentItems.id })
      .from(equipmentItems)
      .where(eq(equipmentItems.id, id))
      .limit(1)
    if (existing) return existing.id
    const [row] = await tx
      .insert(equipmentItems)
      .values({
        id,
        tenantId: ctx.tenantId,
        name: 'Untitled equipment',
        assetTag,
        qrToken,
        status: 'in_service',
        isDraft: true,
      })
      .returning({ id: equipmentItems.id })
    if (!row) throw new Error('Failed to create equipment.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment',
      entityId: row.id,
      action: 'create',
      summary: 'Started equipment draft',
    })
    return row.id
  })
  if (!itemId) return { ok: false, error: 'Failed to create equipment.' }
  revalidatePath('/equipment')
  return { ok: true, id: itemId }
}
