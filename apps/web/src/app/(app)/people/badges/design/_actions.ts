'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { tenants } from '@beaconhs/db/schema'
import type { DesignDocument } from '@beaconhs/design-studio'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import {
  PERSON_BADGE_DESIGN_SETTINGS_KEY,
  defaultPersonBadgeDesign,
  normalizePersonBadgeDesign,
} from '@/lib/person-badge-design'
import { recordAudit } from '@/lib/audit'

export async function savePersonBadgeDesign(input: DesignDocument): Promise<DesignDocument> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  assertCanManageModule(ctx, 'people')

  // Normalize through the shared schema so a malformed payload can never be
  // persisted (unknown elements are dropped, sizes clamped, ids ensured).
  const document = normalizePersonBadgeDesign({
    [PERSON_BADGE_DESIGN_SETTINGS_KEY]: input,
  })
  if (document.artboards.length === 0) {
    throw new Error('Badge design needs at least one artboard')
  }

  await ctx.db(async (tx) => {
    const [tenant] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId!))
      .limit(1)
    const settings = {
      ...(tenant?.settings ?? {}),
      [PERSON_BADGE_DESIGN_SETTINGS_KEY]: document,
    }
    await tx.update(tenants).set({ settings }).where(eq(tenants.id, ctx.tenantId!))
  })

  await recordAudit(ctx, {
    entityType: 'person_badge_design',
    action: 'update',
    summary: 'Saved the ID badge design',
    metadata: {
      artboards: document.artboards.map((artboard) => ({
        id: artboard.id,
        elements: artboard.elements.length,
      })),
    },
  })
  revalidatePath('/people/badges/design')
  return document
}

export async function resetPersonBadgeDesign(): Promise<DesignDocument> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')
  assertCanManageModule(ctx, 'people')
  const document = defaultPersonBadgeDesign()
  await ctx.db(async (tx) => {
    const [tenant] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId!))
      .limit(1)
    const settings = { ...(tenant?.settings ?? {}) } as Record<string, unknown>
    delete settings[PERSON_BADGE_DESIGN_SETTINGS_KEY]
    await tx.update(tenants).set({ settings }).where(eq(tenants.id, ctx.tenantId!))
  })
  await recordAudit(ctx, {
    entityType: 'person_badge_design',
    action: 'update',
    summary: 'Reset the ID badge design to the default',
  })
  revalidatePath('/people/badges/design')
  return document
}
