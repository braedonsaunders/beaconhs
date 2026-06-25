'use server'

// Persist the tenant's risk matrix. Gated by the same permission as the rest of
// the Hazard Assessments Manage hub; written to tenants.risk_matrix (a
// cross-tenant table, so RLS is bypassed inside the transaction, exactly as the
// old tenant-settings page did) and audited. Revalidating the root layout makes
// the new matrix flow straight back through <RiskMatrixProvider> to every
// assessment screen.

import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import { db } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'
import type { RiskMatrixConfig } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'

export type SaveResult = { ok: true } | { ok: false; error: string }

const MAX_LABEL = 48
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function validate(
  config: RiskMatrixConfig,
): { ok: true; value: RiskMatrixConfig } | { ok: false; error: string } {
  const sev = config?.axes?.severity?.values
  const lik = config?.axes?.likelihood?.values
  if (!Array.isArray(sev) || !Array.isArray(lik))
    return { ok: false, error: 'Both axes need labels.' }
  if (sev.length < 2 || lik.length < 2)
    return { ok: false, error: 'Each axis needs at least two levels.' }
  if (sev.length > 8 || lik.length > 8)
    return { ok: false, error: 'Each axis can have at most eight levels.' }

  const cells: RiskMatrixConfig['cells'] = {}
  for (let s = 0; s < sev.length; s++) {
    for (let l = 0; l < lik.length; l++) {
      const c = config.cells?.[`${s}:${l}`]
      if (!c || typeof c.score !== 'number' || typeof c.label !== 'string') {
        return { ok: false, error: 'The matrix is missing one or more cells.' }
      }
      const color = HEX.test(c.color) ? c.color : '#94a3b8'
      cells[`${s}:${l}`] = {
        score: Math.round(c.score),
        label: c.label.slice(0, MAX_LABEL),
        color,
      }
    }
  }

  return {
    ok: true,
    value: {
      axes: {
        severity: { values: sev.map((v) => String(v).slice(0, MAX_LABEL)) },
        likelihood: { values: lik.map((v) => String(v).slice(0, MAX_LABEL)) },
      },
      cells,
    },
  }
}

export async function saveRiskMatrix(config: RiskMatrixConfig): Promise<SaveResult> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'hazid')
  if (!ctx.tenantId) return { ok: false, error: 'No active tenant.' }
  const tenantId = ctx.tenantId

  const parsed = validate(config)
  if (!parsed.ok) return parsed

  const before = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    const [t] = await tx
      .select({ riskMatrix: tenants.riskMatrix })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    return t?.riskMatrix ?? null
  })

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
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
