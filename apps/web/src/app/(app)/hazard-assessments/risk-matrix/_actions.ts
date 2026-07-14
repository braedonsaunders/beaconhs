'use server'

// Persist the tenant's risk matrix. Gated by the same permission as the rest of
// the Hazard Assessments Manage hub; written to tenants.risk_matrix (a
// cross-tenant table, so RLS is bypassed inside the transaction, exactly as the
// old tenant-settings page did) and audited. Revalidating the root layout makes
// the new matrix flow straight back through <RiskMatrixProvider> to every
// assessment screen.

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'
import type { RiskMatrixConfig } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { validateRiskMatrixConfig } from './_policy'

type SaveResult = { ok: true } | { ok: false; error: string }

export async function saveRiskMatrix(config: RiskMatrixConfig): Promise<SaveResult> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'hazid')
  if (!ctx.tenantId) return { ok: false, error: 'No active tenant.' }
  const tenantId = ctx.tenantId

  const parsed = validateRiskMatrixConfig(config)
  if (!parsed.ok) return parsed

  const before = await withSuperAdmin(db, async (tx) => {
    const [t] = await tx
      .select({ riskMatrix: tenants.riskMatrix })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    return t?.riskMatrix ?? null
  })

  await withSuperAdmin(db, async (tx) => {
    await tx.update(tenants).set({ riskMatrix: parsed.value }).where(eq(tenants.id, tenantId))
  })

  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: tenantId,
    action: 'update',
    summary: 'Updated risk matrix',
    before: { riskMatrix: before } as Record<string, unknown>,
    after: { riskMatrix: parsed.value } as Record<string, unknown>,
  })

  // The provider lives in the root (app) layout, so revalidate the whole layout
  // tree to refresh every assessment screen's matrix in one shot.
  revalidatePath('/', 'layout')
  return { ok: true }
}
