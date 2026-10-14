// Public API for AI briefs: list briefs, read their runs, and generate a brief
// for any window on demand — optionally narrowed with per-source parameters
// (e.g. one person's journals). Generation runs with the API key's own
// permissions and record visibility, synchronously, and is recorded as an
// `api` run on the brief.

import { and, asc, count, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { briefRuns, briefs, departments, type BriefSpec } from '@beaconhs/db/schema'
import {
  BriefValidationError,
  explicitBriefWindow,
  isValidTimeZone,
  normalizeSourceConfigs,
} from '@beaconhs/briefs'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { generateBriefRunNow } from '@/lib/briefs/generate'
import { isUuid } from '@/lib/list-params'
import { ApiError } from './errors'

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 25

function pageParams(params: URLSearchParams) {
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(params.get('limit') ?? DEFAULT_LIMIT) || DEFAULT_LIMIT),
  )
  const offset = Math.max(0, Number(params.get('offset') ?? 0) || 0)
  return { limit, offset }
}

function pagination(limit: number, offset: number, total: number, returned: number) {
  return { limit, offset, total, hasMore: offset + returned < total }
}

function serializeBrief(row: typeof briefs.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    specVersion: row.specVersion,
    sources: row.spec.sources.map((s) => s.key),
    sections: row.spec.sections.map((s) => ({ key: s.key, title: s.title })),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function serializeRun(
  row: typeof briefRuns.$inferSelect & { departmentName?: string | null },
  full: boolean,
) {
  return {
    id: row.id,
    briefId: row.briefId,
    trigger: row.trigger,
    status: row.status,
    window: {
      start: row.windowStart.toISOString(),
      end: row.windowEnd.toISOString(),
      label: row.windowLabel,
      timezone: row.timezone,
    },
    department: row.departmentId
      ? { id: row.departmentId, name: row.departmentName ?? null }
      : null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    error: row.error,
    ...(full
      ? {
          result: row.result,
          facts: row.evidence?.facts ?? [],
          records: row.evidence?.records ?? [],
          sources: row.evidence?.sources ?? [],
          model: row.aiMeta
            ? {
                provider: row.aiMeta.provider,
                model: row.aiMeta.model,
                inputTokens: row.aiMeta.inputTokens,
                outputTokens: row.aiMeta.outputTokens,
                droppedCitations: row.aiMeta.droppedCitations,
              }
            : null,
        }
      : { headline: row.result?.headline ?? null }),
  }
}

export async function listBriefsApi(ctx: RequestContext, params: URLSearchParams) {
  const { limit, offset } = pageParams(params)
  const status = params.get('status')
  const where = status === 'active' || status === 'archived' ? eq(briefs.status, status) : undefined
  return ctx.db(async (tx) => {
    const [total] = await tx.select({ n: count() }).from(briefs).where(where)
    const rows = await tx
      .select()
      .from(briefs)
      .where(where)
      .orderBy(asc(briefs.name), asc(briefs.id))
      .limit(limit)
      .offset(offset)
    return {
      data: rows.map(serializeBrief),
      pagination: pagination(limit, offset, Number(total?.n ?? 0), rows.length),
    }
  })
}

async function loadBriefApi(ctx: RequestContext, briefId: string) {
  if (!isUuid(briefId)) throw ApiError.notFound('Brief not found')
  const [row] = await ctx.db((tx) =>
    tx.select().from(briefs).where(eq(briefs.id, briefId)).limit(1),
  )
  if (!row) throw ApiError.notFound('Brief not found')
  return row
}

export async function getBriefApi(ctx: RequestContext, briefId: string) {
  const row = await loadBriefApi(ctx, briefId)
  return {
    data: {
      ...serializeBrief(row),
      instructions: row.spec.instructions,
      targetWords: row.spec.targetWords,
      sourceParams: row.spec.sources,
    },
  }
}

export async function listBriefRunsApi(
  ctx: RequestContext,
  briefId: string,
  params: URLSearchParams,
) {
  await loadBriefApi(ctx, briefId)
  const { limit, offset } = pageParams(params)
  const statusParam = params.get('status')
  const triggerParam = params.get('trigger')
  const status = (['queued', 'running', 'succeeded', 'failed'] as const).find(
    (s) => s === statusParam,
  )
  const trigger = (['scheduled', 'manual', 'preview', 'api'] as const).find(
    (t) => t === triggerParam,
  )
  const where = and(
    eq(briefRuns.briefId, briefId),
    status ? eq(briefRuns.status, status) : undefined,
    trigger ? eq(briefRuns.trigger, trigger) : undefined,
  )
  return ctx.db(async (tx) => {
    const [total] = await tx.select({ n: count() }).from(briefRuns).where(where)
    const rows = await tx
      .select({ run: briefRuns, departmentName: departments.name })
      .from(briefRuns)
      .leftJoin(departments, eq(departments.id, briefRuns.departmentId))
      .where(where)
      .orderBy(desc(briefRuns.createdAt), desc(briefRuns.id))
      .limit(limit)
      .offset(offset)
    return {
      data: rows.map((r) => serializeRun({ ...r.run, departmentName: r.departmentName }, false)),
      pagination: pagination(limit, offset, Number(total?.n ?? 0), rows.length),
    }
  })
}

export async function getBriefRunApi(ctx: RequestContext, briefId: string, runId: string) {
  if (!isUuid(briefId) || !isUuid(runId)) throw ApiError.notFound('Run not found')
  const [row] = await ctx.db((tx) =>
    tx
      .select({ run: briefRuns, departmentName: departments.name })
      .from(briefRuns)
      .leftJoin(departments, eq(departments.id, briefRuns.departmentId))
      .where(and(eq(briefRuns.briefId, briefId), eq(briefRuns.id, runId)))
      .limit(1),
  )
  if (!row) throw ApiError.notFound('Run not found')
  return { data: serializeRun({ ...row.run, departmentName: row.departmentName }, true) }
}

const generateBody = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().min(1).max(64).optional(),
    departmentId: z.uuid().nullish(),
    /** Per-source parameter overrides, e.g. {"journals.entries": {"authorEmployeeNos": ["1042"]}}. */
    sources: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  })
  .strict()

export async function generateBriefRunApi(
  ctx: RequestContext,
  apiKeyId: string,
  briefId: string,
  body: unknown,
) {
  const parsed = generateBody.safeParse(body)
  if (!parsed.success) {
    throw ApiError.invalid(
      parsed.error.issues[0]?.message ?? 'Invalid request body',
      parsed.error.issues,
    )
  }
  const input = parsed.data
  const brief = await loadBriefApi(ctx, briefId)
  if (brief.status !== 'active') throw ApiError.conflict('This brief is archived')
  const timezone = input.timezone ?? ctx.timezone
  if (!isValidTimeZone(timezone)) throw ApiError.invalid('Unknown timezone')
  let window
  let spec: BriefSpec
  try {
    window = explicitBriefWindow(input.from, input.to, timezone)
    const overrides = input.sources ?? {}
    for (const key of Object.keys(overrides)) {
      if (!brief.spec.sources.some((s) => s.key === key)) {
        throw new BriefValidationError(`This brief does not read "${key}"`)
      }
    }
    spec = {
      ...brief.spec,
      sources: normalizeSourceConfigs(
        brief.spec.sources.map((s) => ({
          key: s.key,
          params: { ...s.params, ...overrides[s.key] },
        })),
      ),
    }
  } catch (error) {
    throw ApiError.invalid(error instanceof Error ? error.message : 'Invalid request')
  }
  const run = await generateBriefRunNow({
    ctx,
    brief: { id: brief.id, name: brief.name, specVersion: brief.specVersion },
    spec,
    window,
    departmentId: input.departmentId ?? null,
    trigger: 'api',
    apiKeyId,
  })
  await recordAudit(ctx, {
    entityType: 'brief_run',
    entityId: run.runId,
    action: 'create',
    summary: `Generated AI brief "${brief.name}" through the API`,
    metadata: { briefId: brief.id, status: run.status, window: window.label },
  })
  return getBriefRunApi(ctx, brief.id, run.runId)
}
