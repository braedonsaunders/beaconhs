'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { tenants } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import type { DesignDocument } from '@beaconhs/design-studio'
import { requireRequestContext } from '@/lib/auth'
import {
  EQUIPMENT_LABEL_DESIGN_SETTINGS_KEY,
  defaultEquipmentLabelDesign,
  normalizeEquipmentLabelDesign,
} from '@/lib/equipment-label-design'
import { recordAudit } from '@/lib/audit'

export async function saveEquipmentLabelDesign(input: DesignDocument): Promise<DesignDocument> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  assertCan(ctx, 'equipment.manage')

  // Normalize through the shared schema so a malformed payload can never be
  // persisted (unknown elements are dropped, sizes clamped, ids ensured).
  const document = normalizeEquipmentLabelDesign({
    [EQUIPMENT_LABEL_DESIGN_SETTINGS_KEY]: input,
  })
  if (document.artboards.length === 0) {
    throw new Error('Label design needs one artboard')
  }

  await ctx.db(async (tx) => {
    const [tenant] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId!))
      .limit(1)
    const settings = {
      ...(tenant?.settings ?? {}),
      [EQUIPMENT_LABEL_DESIGN_SETTINGS_KEY]: document,
    }
    await tx.update(tenants).set({ settings }).where(eq(tenants.id, ctx.tenantId!))
  })

  await recordAudit(ctx, {
    entityType: 'equipment_label_design',
    action: 'update',
    summary: 'Saved the equipment QR-label design',
    metadata: {
      artboard: {
        width: document.artboards[0]!.width,
        height: document.artboards[0]!.height,
        elements: document.artboards[0]!.elements.length,
      },
    },
  })
  revalidatePath('/equipment/labels/design')
  return document
}

export async function resetEquipmentLabelDesign(): Promise<DesignDocument> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  assertCan(ctx, 'equipment.manage')
  const document = defaultEquipmentLabelDesign()
  await ctx.db(async (tx) => {
    const [tenant] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId!))
      .limit(1)
    const settings = { ...(tenant?.settings ?? {}) } as Record<string, unknown>
    delete settings[EQUIPMENT_LABEL_DESIGN_SETTINGS_KEY]
    await tx.update(tenants).set({ settings }).where(eq(tenants.id, ctx.tenantId!))
  })
  await recordAudit(ctx, {
    entityType: 'equipment_label_design',
    action: 'update',
    summary: 'Reset the equipment QR-label design to the default',
  })
  revalidatePath('/equipment/labels/design')
  return document
}
