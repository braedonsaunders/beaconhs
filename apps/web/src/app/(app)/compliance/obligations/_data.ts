// Read model for the unified obligations management surface. Now a SINGLE query
// over `compliance_obligations` (+ audience counts), and live compliance via the
// evaluation adapters. The old per-module UNION is gone.

import { and, count, desc, eq, ilike, inArray, isNull, ne, sql } from 'drizzle-orm'
import { complianceAudience, complianceObligations } from '@beaconhs/db/schema'
import type { requireRequestContext } from '@/lib/auth'
import { type AudienceItem, evaluateObligation } from '@beaconhs/compliance'
import type { ComplianceRecurrence } from '@beaconhs/db/schema'
import type { ObligationKind } from './_meta'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

type ObligationRow = {
  kind: ObligationKind
  id: string
  title: string
  audience: string
  cadence: string
  enabled: boolean
}

export function cadenceLabel(rec: ComplianceRecurrence | null | undefined): string {
  if (!rec) return '—'
  if (rec.kind === 'frequency') return `${rec.quantity ?? 1}/${rec.frequency ?? 'week'}`
  if (rec.kind === 'cron') return rec.cron ? `cron ${rec.cron}` : '—'
  if (rec.kind === 'one_time') return rec.dueOn ? `due ${rec.dueOn}` : 'one-off'
  if (rec.kind === 'expiry') return 'continuous'
  return rec.kind
}

type ObligationListResult = { rows: ObligationRow[]; total: number }

export async function listObligations(
  ctx: Ctx,
  opts: { kind?: ObligationKind; q?: string; page?: number; perPage?: number } = {},
): Promise<ObligationListResult> {
  const perPage = opts.perPage ?? 25
  const page = Math.max(1, opts.page ?? 1)
  return ctx.db(async (tx) => {
    const where = and(
      eq(complianceObligations.tenantId, ctx.tenantId),
      isNull(complianceObligations.deletedAt),
      ne(complianceObligations.status, 'archived'),
      opts.kind ? eq(complianceObligations.sourceModule, opts.kind) : undefined,
      opts.q ? ilike(complianceObligations.title, `%${opts.q}%`) : undefined,
    )

    const [tot] = await tx.select({ c: count() }).from(complianceObligations).where(where)
    const total = Number(tot?.c ?? 0)

    const obs = await tx
      .select()
      .from(complianceObligations)
      .where(where)
      .orderBy(desc(complianceObligations.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage)

    const ids = obs.map((o) => o.id)
    const counts = new Map<string, { n: number; everyone: boolean }>()
    if (ids.length > 0) {
      const ac = await tx
        .select({
          id: complianceAudience.obligationId,
          n: sql<number>`count(*)`.mapWith(Number),
          everyone: sql<boolean>`bool_or(${complianceAudience.kind} = 'everyone')`,
        })
        .from(complianceAudience)
        .where(inArray(complianceAudience.obligationId, ids))
        .groupBy(complianceAudience.obligationId)
      for (const r of ac) counts.set(r.id, { n: r.n, everyone: r.everyone })
    }

    const rows = obs.map((o) => {
      const audienceInfo = counts.get(o.id)
      return {
        kind: o.sourceModule as ObligationKind,
        id: o.id,
        title: o.title,
        audience:
          o.subjectKind === 'per_record'
            ? 'Records'
            : o.subjectKind === 'per_task'
              ? 'Title holders'
              : !audienceInfo || audienceInfo.everyone || audienceInfo.n === 0
                ? 'Everyone'
                : `${audienceInfo.n} target${audienceInfo.n === 1 ? '' : 's'}`,
        cadence: cadenceLabel(o.recurrence),
        enabled: o.status === 'active',
      }
    })
    return { rows, total }
  })
}

async function getObligationWithAudience(ctx: Ctx, id: string) {
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
