import 'server-only'

// Generic CAPA spawn for native-module flows. Mirrors the form-response spawn
// (reference numbering + polymorphic sourceEntityType/Id) so a journal / hazard
// assessment / incident flow can create a corrective action.

import { count, sql } from 'drizzle-orm'
import { correctiveActions } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'

type CaSource = 'inspection' | 'incident' | 'near_miss' | 'observation' | 'audit' | 'jsha' | 'other'

export async function spawnCorrectiveActionForSubject(
  ctx: RequestContext,
  input: {
    sourceEntityType: string
    sourceEntityId: string
    source: CaSource
    title: string
    description?: string | null
    severity?: 'low' | 'medium' | 'high' | 'critical'
    dueOn?: string | null
    siteOrgUnitId?: string | null
  },
): Promise<{ ok: boolean }> {
  if (!ctx.tenantId) return { ok: false }
  const title = input.title?.trim()
  if (!title) return { ok: false }
  const assignedOn = new Date().toISOString().slice(0, 10)

  const row = await ctx.db(async (tx) => {
    const year = new Date().getFullYear()
    const [{ c } = { c: 0 }] = await tx
      .select({ c: count() })
      .from(correctiveActions)
      .where(
        sql`extract(year from coalesce(${correctiveActions.assignedOn}, current_date)) = ${year}`,
      )
    const reference = `CA-${year}-${String(Number(c ?? 0) + 1).padStart(4, '0')}`
    const [inserted] = await tx
      .insert(correctiveActions)
      .values({
        tenantId: ctx.tenantId,
        reference,
        title,
        description: input.description?.trim() || null,
        severity: input.severity ?? 'medium',
        status: 'open',
        source: input.source,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        siteOrgUnitId: input.siteOrgUnitId ?? null,
        assignedOn,
        dueOn: input.dueOn ?? null,
        assignedByTenantUserId: ctx.membership?.id,
        ownerTenantUserId: ctx.membership?.id,
      })
      .returning({ id: correctiveActions.id, reference: correctiveActions.reference })
    return inserted
  })

  if (!row) return { ok: false }
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: row.id,
    action: 'create',
    summary: `Spawned ${row.reference} from ${input.sourceEntityType} flow`,
  })
  return { ok: true }
}
