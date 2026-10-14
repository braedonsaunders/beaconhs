import 'server-only'

import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  attachments,
  briefRunDeliveries,
  briefRuns,
  briefs,
  briefSchedules,
  departments,
  type BriefEvidence,
  type BriefResult,
} from '@beaconhs/db/schema'
import type { Database } from '@beaconhs/db'
import type { RequestContext } from '@beaconhs/tenant'

/** The latest finished run of each brief (preview runs excluded). */
export async function latestBriefRuns(
  ctx: RequestContext,
  briefIds: string[],
): Promise<Map<string, LatestBriefRun>> {
  if (briefIds.length === 0) return new Map<string, LatestBriefRun>()
  const rows = await ctx.db((tx) =>
    tx
      .selectDistinctOn([briefRuns.briefId], {
        briefId: briefRuns.briefId,
        id: briefRuns.id,
        status: briefRuns.status,
        windowLabel: briefRuns.windowLabel,
        finishedAt: briefRuns.finishedAt,
        result: briefRuns.result,
        evidence: briefRuns.evidence,
        departmentName: departments.name,
      })
      .from(briefRuns)
      .leftJoin(departments, eq(departments.id, briefRuns.departmentId))
      .where(
        and(
          inArray(briefRuns.briefId, briefIds),
          eq(briefRuns.status, 'succeeded'),
          sql`${briefRuns.trigger} <> 'preview'`,
        ),
      )
      .orderBy(briefRuns.briefId, desc(briefRuns.windowEnd), desc(briefRuns.finishedAt)),
  )
  return new Map(rows.map((row) => [row.briefId, row]))
}

export type LatestBriefRun = {
  briefId: string
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  windowLabel: string
  finishedAt: Date | null
  result: BriefResult | null
  evidence: BriefEvidence | null
  departmentName: string | null
}

export async function loadBrief(ctx: RequestContext, id: string) {
  const [row] = await ctx.db((tx) => tx.select().from(briefs).where(eq(briefs.id, id)).limit(1))
  return row ?? null
}

export async function loadBriefRun(ctx: RequestContext, briefId: string, runId: string) {
  const [row] = await ctx.db((tx) =>
    tx
      .select({
        run: briefRuns,
        departmentName: departments.name,
        scheduleName: briefSchedules.name,
        pdf: { id: attachments.id, filename: attachments.filename, r2Key: attachments.r2Key },
      })
      .from(briefRuns)
      .leftJoin(departments, eq(departments.id, briefRuns.departmentId))
      .leftJoin(briefSchedules, eq(briefSchedules.id, briefRuns.scheduleId))
      .leftJoin(attachments, eq(attachments.id, briefRuns.pdfAttachmentId))
      .where(and(eq(briefRuns.briefId, briefId), eq(briefRuns.id, runId)))
      .limit(1),
  )
  return row ?? null
}

export async function countDeliveries(ctx: RequestContext, runIds: string[]) {
  if (runIds.length === 0) return new Map<string, number>()
  const rows = await ctx.db((tx) =>
    tx
      .select({ runId: briefRunDeliveries.runId, n: count() })
      .from(briefRunDeliveries)
      .where(inArray(briefRunDeliveries.runId, runIds))
      .groupBy(briefRunDeliveries.runId),
  )
  return new Map(rows.map((row) => [row.runId, Number(row.n)]))
}

export type BriefHeadline = {
  briefId: string
  briefName: string
  runId: string
  windowLabel: string
  headline: string
  finishedAt: Date | null
}

/** The newest delivered brief of each active brief, newest first (dashboard). */
export async function loadLatestBriefHeadlines(tx: Database, limit = 6): Promise<BriefHeadline[]> {
  const rows = await tx
    .selectDistinctOn([briefRuns.briefId], {
      briefId: briefRuns.briefId,
      briefName: briefs.name,
      runId: briefRuns.id,
      windowLabel: briefRuns.windowLabel,
      headline: sql<string>`coalesce(${briefRuns.result} ->> 'headline', '')`,
      finishedAt: briefRuns.finishedAt,
    })
    .from(briefRuns)
    .innerJoin(briefs, eq(briefs.id, briefRuns.briefId))
    .where(
      and(
        eq(briefs.status, 'active'),
        eq(briefRuns.status, 'succeeded'),
        sql`${briefRuns.trigger} <> 'preview'`,
      ),
    )
    .orderBy(briefRuns.briefId, desc(briefRuns.windowEnd), desc(briefRuns.finishedAt))
  return rows
    .sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0))
    .slice(0, limit)
}
