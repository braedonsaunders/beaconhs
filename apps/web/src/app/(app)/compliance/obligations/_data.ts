// Read model for the unified obligations management surface. Now a SINGLE query
// over `compliance_obligations` (+ audience counts), and live compliance via the
// evaluation adapters. The old per-module UNION is gone.

import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { complianceAudience, complianceObligations } from '@beaconhs/db/schema'
import type { requireRequestContext } from '@/lib/auth'
import { type AudienceItem, evaluateObligation } from '@beaconhs/compliance'
import type { ComplianceRecurrence } from '@beaconhs/db/schema'
import type { ObligationKind } from './_meta'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

export type ObligationRow = {
  kind: ObligationKind
  id: string
  title: string
  audience: string
  cadence: string
  enabled: boolean
}

function cadenceLabel(rec: ComplianceRecurrence | null | undefined): string {
  if (!rec) return '—'
  if (rec.kind === 'frequency') return `${rec.quantity ?? 1}/${rec.frequency ?? 'week'}`
  if (rec.kind === 'cron') return rec.cron ? `cron ${rec.cron}` : '—'
  if (rec.kind === 'one_time') return rec.dueOn ? `due ${rec.dueOn}` : 'one-off'
  if (rec.kind === 'expiry') return 'continuous'
  return rec.kind
}

export async function listObligations(
  ctx: Ctx,
  filterKind?: ObligationKind,
): Promise<ObligationRow[]> {
  return ctx.db(async (tx) => {
    const obs = await tx
      .select()
      .from(complianceObligations)
      .where(
        and(
          eq(complianceObligations.tenantId, ctx.tenantId),
          isNull(complianceObligations.deletedAt),
          ne(complianceObligations.status, 'archived'),
          filterKind ? eq(complianceObligations.sourceModule, filterKind) : undefined,
        ),
      )
      .orderBy(desc(complianceObligations.createdAt))
      .limit(1000)

    const ids = obs.map((o) => o.id)
    const counts = new Map<string, number>()
    if (ids.length > 0) {
      const ac = await tx
        .select({
          id: complianceAudience.obligationId,
          n: sql<number>`count(*)`.mapWith(Number),
        })
        .from(complianceAudience)
        .where(inArray(complianceAudience.obligationId, ids))
        .groupBy(complianceAudience.obligationId)
      for (const r of ac) counts.set(r.id, r.n)
    }

    return obs.map((o) => ({
      kind: o.sourceModule as ObligationKind,
      id: o.id,
      title: o.title,
      audience:
        o.subjectKind === 'per_record'
          ? 'Records'
          : o.subjectKind === 'per_task'
            ? 'Title holders'
            : counts.get(o.id)
              ? `${counts.get(o.id)} target${counts.get(o.id) === 1 ? '' : 's'}`
              : 'Everyone',
      cadence: cadenceLabel(o.recurrence),
      enabled: o.status === 'active',
    }))
  })
}

export async function getObligationWithAudience(ctx: Ctx, id: string) {
  return ctx.db(async (tx) => {
    const [ob] = await tx
      .select()
      .from(complianceObligations)
      .where(eq(complianceObligations.id, id))
      .limit(1)
    if (!ob || ob.deletedAt) return null
    const aud = await tx
      .select({ kind: complianceAudience.kind, entityKey: complianceAudience.entityKey })
      .from(complianceAudience)
      .where(eq(complianceAudience.obligationId, id))
    const audience: AudienceItem[] = aud.map((a) => ({
      kind: a.kind as AudienceItem['kind'],
      entityKey: a.entityKey,
    }))
    return { ob, audience }
  })
}

export async function obligationCompliance(ctx: Ctx, id: string) {
  const data = await getObligationWithAudience(ctx, id)
  if (!data) return null
  const result = await ctx.db((tx) => evaluateObligation(tx, ctx.tenantId, data.ob, data.audience))
  return { obligation: data.ob, audience: data.audience, result }
}
