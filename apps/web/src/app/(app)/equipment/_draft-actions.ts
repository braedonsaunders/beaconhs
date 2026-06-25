'use server'

import { revalidatePath } from 'next/cache'
import { randomBytes } from 'crypto'
import { eq } from 'drizzle-orm'
import { equipmentItems } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

/**
 * Lazy draft create: called by the /equipment/new page's LazyRecordProvider on
 * the user's first name edit — so glancing at "new" and leaving creates
 * nothing. Returns the id; the provider then navigates into the detail editor.
 * The item stays flagged `isDraft` (Draft badge) until the edit form is saved.
 */
export async function createEquipmentDraft(): Promise<
  { ok: true; id: string } | { ok: false; error: string }
> {
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
  if (!itemId) return { ok: false, error: 'Failed to create equipment.' }
  await recordAudit(ctx, {
    entityType: 'equipment_item',
    entityId: itemId,
    action: 'create',
    summary: 'Started a draft equipment item',
  })
  revalidatePath('/equipment')
  return { ok: true, id: itemId }
}

// Name field-update for the lazy /equipment/new name field (LiveField FormData
// contract). The full edit form on the detail page clears the draft flag.
export async function updateEquipmentName(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const value = String(formData.get('value') ?? '')
  if (!id) throw new Error('Missing id')
  const name = value.trim() || 'Untitled equipment'
  await ctx.db((tx) => tx.update(equipmentItems).set({ name }).where(eq(equipmentItems.id, id)))
  revalidatePath(`/equipment/${id}`)
  revalidatePath('/equipment')
}
