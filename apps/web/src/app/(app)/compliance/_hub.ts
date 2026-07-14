// Unified hub read layer. Every rollup view (Overview / By person / Aging /
// Mine) reads the materialised `compliance_status` scoreboard — fast aggregate
// queries, one source of truth, kept fresh by the worker scan. Replaces the old
// per-module legacy breakdowns entirely.

import { and, asc, count, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm'
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

type RollupRow = {
  kind: ObligationKind
  id: string
  title: string
  total: number
  completed: number
  overdue: number
  percent: number
}

type ObligationOverview = {
  rows: RollupRow[]
  total: number
  page: number
  summary: {
    obligations: number
    subjects: number
    completed: number
    overdue: number
  }
}

/** Searchable, server-paged obligation aggregates plus an uncapped org-wide summary. */
export async function obligationOverview(
  ctx: Ctx,
  opts: { q?: string; page: number; perPage: number },
): Promise<ObligationOverview> {
  return ctx.db(async (tx) => {
    const live = and(eq(complianceObligations.tenantId, ctx.tenantId), ...liveFilter())
    const filtered = and(
      eq(complianceObligations.tenantId, ctx.tenantId),
      ...liveFilter(),
      opts.q ? ilike(complianceObligations.title, `%${opts.q}%`) : undefined,
    )
    const [summaryRows, totalRows] = await Promise.all([
      tx
        .select({
          obligations: sql<number>`count(distinct ${complianceObligations.id})::int`,
          subjects: sql<number>`count(${complianceStatus.id})::int`,
          completed: sql<number>`count(${complianceStatus.id}) filter (where ${complianceStatus.status} = 'completed')::int`,
          overdue: sql<number>`count(${complianceStatus.id}) filter (where ${complianceStatus.status} in ('overdue','expiring'))::int`,
        })
        .from(complianceObligations)
        .leftJoin(complianceStatus, eq(complianceStatus.obligationId, complianceObligations.id))
        .where(live),
      tx.select({ total: count() }).from(complianceObligations).where(filtered),
    ])
    const total = Number(totalRows[0]?.total ?? 0)
    const pageCount = Math.max(1, Math.ceil(total / opts.perPage))
    const page = Math.min(Math.max(1, opts.page), pageCount)
    const totalSubjects = sql<number>`count(${complianceStatus.id})::int`
    const completed = sql<number>`count(${complianceStatus.id}) filter (where ${complianceStatus.status} = 'completed')::int`
    const overdue = sql<number>`count(${complianceStatus.id}) filter (where ${complianceStatus.status} in ('overdue','expiring'))::int`
    const percent = sql<number>`case
      when count(${complianceStatus.id}) = 0 then 0
      else round(
        count(${complianceStatus.id}) filter (where ${complianceStatus.status} = 'completed')::numeric
        / count(${complianceStatus.id})::numeric * 100
      )::int
    end`
    const rows = await tx
      .select({
        id: complianceObligations.id,
        kind: complianceObligations.sourceModule,
        title: complianceObligations.title,
        total: totalSubjects,
        completed,
        overdue,
        percent,
      })
      .from(complianceObligations)
      .leftJoin(complianceStatus, eq(complianceStatus.obligationId, complianceObligations.id))
      .where(filtered)
      .groupBy(complianceObligations.id)
      .orderBy(
        desc(overdue),
        asc(percent),
        asc(complianceObligations.title),
        asc(complianceObligations.id),
      )
      .limit(opts.perPage)
      .offset((page - 1) * opts.perPage)

    const summary = summaryRows[0]
    return {
      rows: rows.map((row) => ({
        kind: row.kind as ObligationKind,
        id: row.id,
        title: row.title,
        total: Number(row.total),
        completed: Number(row.completed),
        overdue: Number(row.overdue),
        percent: Number(row.percent),
      })),
      total,
      page,
      summary: {
        obligations: Number(summary?.obligations ?? 0),
        subjects: Number(summary?.subjects ?? 0),
        completed: Number(summary?.completed ?? 0),
        overdue: Number(summary?.overdue ?? 0),
      },
    }
  })
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
  /** Exact completion record when an evaluator can provide one. */
  subjectRef: Record<string, string> | null
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
        subjectRef: complianceStatus.subjectRef,
      })
      .from(complianceStatus)
      .innerJoin(complianceObligations, eq(complianceObligations.id, complianceStatus.obligationId))
      .where(
        and(
          eq(complianceStatus.tenantId, ctx.tenantId),
          eq(complianceStatus.personId, personId),
          ...liveFilter(),
        ),
      ),
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
      subjectRef: r.subjectRef,
    }))
    .sort((a, b) => rank(a.status) - rank(b.status) || a.title.localeCompare(b.title))
}

export type AgingBucket = '0_7' | '7_30' | '30_plus' | 'no_date'
type AgingRow = { kind: ObligationKind; bucket: AgingBucket; count: number }

/** Overdue / expiring subjects bucketed by age of due date. */
export async function agingFromStatus(ctx: Ctx): Promise<AgingRow[]> {
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const t7 = iso(new Date(today.getTime() - 7 * 864e5))
  const t30 = iso(new Date(today.getTime() - 30 * 864e5))
  return ctx.db(async (tx) => {
    const bucket = sql<AgingBucket>`case
      when ${complianceStatus.dueOn} is null then 'no_date'
      when ${complianceStatus.dueOn} >= ${t7}::date then '0_7'
      when ${complianceStatus.dueOn} >= ${t30}::date then '7_30'
      else '30_plus'
    end`
    const rows = await tx
      .select({
        kind: complianceObligations.sourceModule,
        bucket,
        count: sql<number>`count(*)::int`,
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
      .groupBy(complianceObligations.sourceModule, bucket)
    return rows.map((row) => ({
      kind: row.kind as ObligationKind,
      bucket: row.bucket,
      count: Number(row.count),
    }))
  })
}

export { kindLabel }
