// Unified hub read layer. Every rollup view (Overview / By person / Aging /
// Mine) reads the materialised `compliance_status` scoreboard — fast aggregate
// queries, one source of truth, kept fresh by the worker scan. Replaces the old
// per-module legacy breakdowns entirely.

import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  type ComplianceTargetRef,
  complianceObligations,
  complianceStatus,
} from '@beaconhs/db/schema'
import type { requireRequestContext } from '@/lib/auth'
import { type ObligationKind, kindLabel } from './obligations/_meta'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

// Scoreboard reads only count ACTIVE obligations — a paused (disabled)
// obligation stops counting against people immediately (its compliance_status
// rows also stop being refreshed by the scan, so they would go stale anyway).
const liveFilter = () => [
  isNull(complianceObligations.deletedAt),
  eq(complianceObligations.status, 'active'),
]

export type RollupRow = {
  kind: ObligationKind
  id: string
  title: string
  total: number
  completed: number
  overdue: number
  percent: number
}

/** Per-obligation compliance aggregate for the Overview. */
export async function obligationRollup(ctx: Ctx): Promise<RollupRow[]> {
  const rows = await ctx.db((tx) =>
    tx
      .select({
        id: complianceObligations.id,
        kind: complianceObligations.sourceModule,
        title: complianceObligations.title,
        total: sql<number>`count(${complianceStatus.id})::int`,
        completed: sql<number>`count(*) filter (where ${complianceStatus.status} = 'completed')::int`,
        overdue: sql<number>`count(*) filter (where ${complianceStatus.status} in ('overdue','expiring'))::int`,
      })
      .from(complianceObligations)
      .leftJoin(complianceStatus, eq(complianceStatus.obligationId, complianceObligations.id))
      .where(and(eq(complianceObligations.tenantId, ctx.tenantId), ...liveFilter()))
      .groupBy(complianceObligations.id)
      .limit(1000),
  )
  return rows
    .map((r) => ({
      kind: r.kind as ObligationKind,
      id: r.id,
      title: r.title,
      total: Number(r.total),
      completed: Number(r.completed),
      overdue: Number(r.overdue),
      percent:
        Number(r.total) === 0 ? 0 : Math.round((Number(r.completed) / Number(r.total)) * 100),
    }))
    .sort((a, b) => b.overdue - a.overdue || a.percent - b.percent)
}

export type PersonStatusRow = {
  kind: ObligationKind
  obligationId: string
  title: string
  status: string
  dueOn: string | null
  completedOn: string | null
  /** Module target (documentId / courseId / formTemplateId / …) for deep-linking. */
  targetRef: ComplianceTargetRef | null
}

/** Everything one person owes, across every obligation kind. */
export async function personCompliance(ctx: Ctx, personId: string): Promise<PersonStatusRow[]> {
  const rows = await ctx.db((tx) =>
    tx
      .select({
        kind: complianceObligations.sourceModule,
        obligationId: complianceObligations.id,
        title: complianceObligations.title,
        status: complianceStatus.status,
        dueOn: complianceStatus.dueOn,
        completedOn: complianceStatus.completedOn,
        targetRef: complianceObligations.targetRef,
      })
      .from(complianceStatus)
      .innerJoin(complianceObligations, eq(complianceObligations.id, complianceStatus.obligationId))
      .where(
        and(
          eq(complianceStatus.tenantId, ctx.tenantId),
          eq(complianceStatus.personId, personId),
          ...liveFilter(),
        ),
      )
      .limit(1000),
  )
  const rank = (s: string) =>
    s === 'overdue' || s === 'expiring' ? 0 : s === 'pending' ? 1 : s === 'in_progress' ? 2 : 3
  return rows
    .map((r) => ({
      kind: r.kind as ObligationKind,
      obligationId: r.obligationId,
      title: r.title,
      status: r.status,
      dueOn: r.dueOn,
      completedOn: r.completedOn,
      targetRef: r.targetRef,
    }))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.title.localeCompare(b.title))
}

export type AgingBucket = '0_7' | '7_30' | '30_plus' | 'no_date'
export type AgingRow = { kind: ObligationKind; bucket: AgingBucket; count: number }

/** Overdue / expiring subjects bucketed by age of due date. */
export async function agingFromStatus(ctx: Ctx): Promise<AgingRow[]> {
  const rows = await ctx.db((tx) =>
    tx
      .select({
        kind: complianceObligations.sourceModule,
        dueOn: complianceStatus.dueOn,
      })
      .from(complianceStatus)
      .innerJoin(complianceObligations, eq(complianceObligations.id, complianceStatus.obligationId))
      .where(
        and(
          eq(complianceStatus.tenantId, ctx.tenantId),
          inArray(complianceStatus.status, ['overdue', 'expiring']),
          ...liveFilter(),
        ),
      )
      .limit(5000),
  )
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const t7 = iso(new Date(today.getTime() - 7 * 864e5))
  const t30 = iso(new Date(today.getTime() - 30 * 864e5))
  const collapsed = new Map<string, AgingRow>()
  for (const r of rows) {
    const bucket: AgingBucket = !r.dueOn
      ? 'no_date'
      : r.dueOn >= t7
        ? '0_7'
        : r.dueOn >= t30
          ? '7_30'
          : '30_plus'
    const key = `${r.kind}::${bucket}`
    const cur = collapsed.get(key) ?? { kind: r.kind as ObligationKind, bucket, count: 0 }
    cur.count += 1
    collapsed.set(key, cur)
  }
  return Array.from(collapsed.values())
}

export { kindLabel }
