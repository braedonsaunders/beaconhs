'use server'

import { eq } from 'drizzle-orm'
import { tenants } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import {
  CREDENTIAL_DESIGN_SETTINGS_KEY,
  normalizeCredentialDesign,
  type CredentialDesign,
} from '@/lib/credential-designs'
import { recordAudit } from '@/lib/audit'

export async function saveCredentialDesign(input: CredentialDesign) {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) throw new Error('No active tenant')

  const design = normalizeCredentialDesign(input)
  await ctx.db(async (tx) => {
    const [tenant] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId!))
      .limit(1)
    const settings = {
      ...(tenant?.settings ?? {}),
      [CREDENTIAL_DESIGN_SETTINGS_KEY]: design,
    }
    await tx.update(tenants).set({ settings }).where(eq(tenants.id, ctx.tenantId!))
  })

  await recordAudit(ctx, {
    entityType: 'training_credential_design',
    action: 'update',
    summary: 'Saved training credential design',
    metadata: { format: design.format, templateId: design.templateId },
  })

  return design
}
