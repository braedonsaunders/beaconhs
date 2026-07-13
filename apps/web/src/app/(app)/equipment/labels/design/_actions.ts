'use server'

import { revalidatePath } from 'next/cache'
import { assertCan } from '@beaconhs/tenant'
import type { DesignDocument } from '@beaconhs/design-studio'
import { requireRequestContext } from '@/lib/auth'
import {
  EQUIPMENT_LABEL_DESIGN_SETTINGS_KEY,
  defaultEquipmentLabelDesign,
  normalizeEquipmentLabelDesign,
} from '@/lib/equipment-label-design'
import { recordAudit } from '@/lib/audit'
import { deleteTenantSetting, setTenantSetting } from '@/lib/tenant-settings'

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

  await setTenantSetting(ctx, EQUIPMENT_LABEL_DESIGN_SETTINGS_KEY, document)

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

async function resetEquipmentLabelDesign(): Promise<DesignDocument> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  assertCan(ctx, 'equipment.manage')
  const document = defaultEquipmentLabelDesign()
  await deleteTenantSetting(ctx, EQUIPMENT_LABEL_DESIGN_SETTINGS_KEY)
  await recordAudit(ctx, {
    entityType: 'equipment_label_design',
    action: 'update',
    summary: 'Reset the equipment QR-label design to the default',
  })
  revalidatePath('/equipment/labels/design')
  return document
}
