import 'server-only'

// Synchronous brief generation for the studio preview and the public API: the
// caller's own context supplies visibility, the run row records exactly what
// was read and written, and nothing is delivered.

import { and, desc, eq, isNull, lt, ne } from 'drizzle-orm'
import { briefRuns, departments, type BriefResult, type BriefSpec } from '@beaconhs/db/schema'
import { generateBrief, type ResolvedBriefWindow } from '@beaconhs/briefs'
import type { RequestContext } from '@beaconhs/tenant'
import { getTenantAiResolution } from '@/lib/ai-config'

export type SyncBriefRun = {
  runId: string
  status: 'succeeded' | 'failed'
  error: string | null
}

export async function generateBriefRunNow(args: {
  ctx: RequestContext
  brief: { id: string; name: string; specVersion: number }
  spec: BriefSpec
  window: ResolvedBriefWindow
  departmentId: string | null
  trigger: 'preview' | 'api'
  apiKeyId?: string | null
}): Promise<SyncBriefRun> {
  const { ctx, brief, spec, window } = args
  const memberId =
    ctx.membership?.id && ctx.membership.id !== 'super-admin' ? ctx.membership.id : null
  const { runId, departmentName, previous } = await ctx.db(async (tx) => {
    const [department] = args.departmentId
      ? await tx
          .select({ name: departments.name })
          .from(departments)
          .where(eq(departments.id, args.departmentId))
          .limit(1)
      : []
    if (args.departmentId && !department) throw new Error('Department was not found')
    const [prior] = spec.compareWithPrevious
      ? await tx
          .select({ windowLabel: briefRuns.windowLabel, result: briefRuns.result })
          .from(briefRuns)
          .where(
            and(
              eq(briefRuns.briefId, brief.id),
              eq(briefRuns.status, 'succeeded'),
              ne(briefRuns.trigger, 'preview'),
              lt(briefRuns.windowEnd, window.end),
              args.departmentId
                ? eq(briefRuns.departmentId, args.departmentId)
                : isNull(briefRuns.departmentId),
            ),
          )
          .orderBy(desc(briefRuns.windowEnd))
          .limit(1)
      : []
    const [run] = await tx
      .insert(briefRuns)
      .values({
        tenantId: ctx.tenantId,
        briefId: brief.id,
        trigger: args.trigger,
        status: 'running',
        briefName: brief.name,
        specVersion: brief.specVersion,
        specSnapshot: spec,
        windowStart: window.start,
        windowEnd: window.end,
        windowLabel: window.label,
        timezone: window.timezone,
        departmentId: args.departmentId,
        runAsTenantUserId: memberId,
        requestedByTenantUserId: memberId,
        requestedByApiKeyId: args.apiKeyId ?? null,
        startedAt: new Date(),
      })
      .returning({ id: briefRuns.id })
    if (!run) throw new Error('The brief run could not be recorded')
    return {
      runId: run.id,
      departmentName: department?.name ?? null,
      previous:
        prior?.result != null
          ? { windowLabel: prior.windowLabel, result: prior.result as BriefResult }
          : null,
    }
  })

  try {
    const ai = await getTenantAiResolution(ctx)
    const generated = await generateBrief({
      ctx,
      briefName: brief.name,
      spec,
      specVersion: brief.specVersion,
      window,
      scope: { departmentId: args.departmentId, departmentName },
      ai: { config: ai.config, reason: ai.reason },
      previous,
    })
    await ctx.db((tx) =>
      tx
        .update(briefRuns)
        .set({
          status: 'succeeded',
          result: generated.result,
          evidence: generated.evidence,
          aiMeta: generated.aiMeta,
          finishedAt: new Date(),
        })
        .where(eq(briefRuns.id, runId)),
    )
    return { runId, status: 'succeeded', error: null }
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000)
    await ctx.db((tx) =>
      tx
        .update(briefRuns)
        .set({ status: 'failed', error: message, finishedAt: new Date() })
        .where(eq(briefRuns.id, runId)),
    )
    return { runId, status: 'failed', error: message }
  }
}
