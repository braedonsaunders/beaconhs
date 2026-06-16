'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { randomBytes } from 'crypto'
import { equipmentItems } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

/**
 * Instant-create a DRAFT equipment item and land in its detail editor (Edit
 * tab). The item appears in the register immediately with a "Draft" badge; the
 * flag clears the first time its details are saved. Asset tag + name get
 * placeholders the user replaces.
 */
export async function createEquipmentDraft(): Promise<void> {
  const ctx = await requireRequestContext()
  const qrToken = randomBytes(12).toString('base64url')
  const assetTag = `DRAFT-${randomBytes(3).toString('hex').toUpperCase()}`
  const itemId = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(equipmentItems)
      .values({
        tenantId: ctx.tenantId,
        name: 'Untitled equipment',
        assetTag,
        qrToken,
        status: 'in_service',
        isDraft: true,
      })
      .returning({ id: equipmentItems.id })
    return row?.id
  })
  if (!itemId) return
  await recordAudit(ctx, {
    entityType: 'equipment_item',
    entityId: itemId,
    action: 'create',
    summary: 'Started a draft equipment item',
  })
  revalidatePath('/equipment')
  redirect(`/equipment/${itemId}?tab=edit`)
}
