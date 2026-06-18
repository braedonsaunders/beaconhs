'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import {
  resultShapeOf,
  suggestViz,
  type BhqlResult,
  type ResultColumn,
  type VizKey,
} from '@beaconhs/analytics'
import { runBhql, validateBhql } from '@beaconhs/analytics/server'
import { insightCards, type BhqlQuery, type InsightCardConfig } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiConfig } from '@/lib/ai-config'
import { canCreateInsights, canPublishInsights, canViewInsights } from '../_access'
import { generateBhqlFromPrompt } from './_lib/ai-card'

type Ok<T = {}> = { ok: true } & T
type Err = { ok: false; error: string }

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong.'
}

function columnsForSuggest(result: BhqlResult): ResultColumn[] {
  return result.shape === 'flat'
    ? result.columns
    : [...result.rowDimensions, ...result.columnDimensions, ...result.valueMeasures]
}

/** Run a draft query live for the builder preview (row-capped, under RLS). */
export async function previewCard(payload: {
  query: unknown
}): Promise<Ok<{ result: BhqlResult; suggestedViz: VizKey }> | Err> {
  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) return { ok: false, error: 'You don’t have access to Insights.' }
  try {
    const query = validateBhql(payload.query)
    const result = await ctx.db((tx) => runBhql(tx, query, { maxRows: 1000 }))
    const cols = columnsForSuggest(result)
    const suggestedViz = suggestViz(
      resultShapeOf(result),
      cols.map((c) => c.semanticType),
      cols,
    )
    return { ok: true, result, suggestedViz }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

/** Natural-language → BHQL. Drafts a validated query (+ a suggested viz) from a
 *  prompt for the builder to hydrate and the human to refine. Never saves. */
export async function generateCard(
  prompt: string,
): Promise<Ok<{ query: BhqlQuery; suggestedViz: VizKey }> | Err> {
  const ctx = await requireRequestContext()
  if (!canCreateInsights(ctx)) return { ok: false, error: 'You can’t create Cards.' }
  const trimmed = (prompt ?? '').trim()
  if (trimmed.length < 3) {
    return { ok: false, error: 'Describe the chart — e.g. “incidents by month this year”.' }
  }

  const aiConfig = await getTenantAiConfig(ctx)
  if (!aiConfig) {
    return { ok: false, error: 'AI is not configured. Set a provider + key under Admin → AI.' }
  }

  const today = new Date().toISOString().slice(0, 10)
  const gen = await generateBhqlFromPrompt(aiConfig, trimmed, today)
  if (!gen.ok) return { ok: false, error: gen.error }
  const query = gen.value

  // Best-effort: run the draft (row-capped, under RLS) to auto-pick a viz, exactly
  // like previewCard. If it can't run, fall back to a table — the builder's own
  // live preview re-suggests once the query is hydrated.
  let suggestedViz: VizKey = 'table'
  try {
    const result = await ctx.db((tx) => runBhql(tx, query, { maxRows: 1000 }))
    const cols = columnsForSuggest(result)
    suggestedViz = suggestViz(
      resultShapeOf(result),
      cols.map((c) => c.semanticType),
      cols,
    )
  } catch {
    // leave as 'table'
  }
  return { ok: true, query, suggestedViz }
}

export async function createCard(input: {
  name: string
  description?: string
  query: unknown
  vizType: string
  vizSettings?: Record<string, unknown>
  kind?: 'question' | 'ai'
  config?: InsightCardConfig | null
}): Promise<Ok<{ id: string }> | Err> {
  const ctx = await requireRequestContext()
  if (!canCreateInsights(ctx)) return { ok: false, error: 'You can’t create Cards.' }
  let query
  try {
    query = validateBhql(input.query)
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
  const [row] = await ctx.db((tx) =>
    tx
      .insert(insightCards)
      .values({
        tenantId: ctx.tenantId,
        createdBy: ctx.userId,
        name: input.name.trim().slice(0, 120) || 'Untitled card',
        description: input.description?.trim().slice(0, 500) || null,
        kind: input.kind ?? 'question',
        query,
        vizType: input.vizType,
        vizSettings: input.vizSettings ?? {},
        config: input.config ?? null,
      })
      .returning({ id: insightCards.id }),
  )
  revalidatePath('/insights')
  return row ? { ok: true, id: row.id } : { ok: false, error: 'Could not create the Card.' }
}

async function ownsOrManages(ctx: Awaited<ReturnType<typeof requireRequestContext>>, id: string) {
  const [row] = await ctx.db((tx) =>
    tx
      .select({ createdBy: insightCards.createdBy })
      .from(insightCards)
      .where(eq(insightCards.id, id))
      .limit(1),
  )
  if (!row) return false
  return ctx.isSuperAdmin || row.createdBy === ctx.userId
}

export async function updateCard(input: {
  id: string
  name: string
  description?: string
  query: unknown
  vizType: string
  vizSettings?: Record<string, unknown>
  kind?: 'question' | 'ai'
  config?: InsightCardConfig | null
}): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!canCreateInsights(ctx) || !(await ownsOrManages(ctx, input.id))) {
    return { ok: false, error: 'Card not found.' }
  }
  let query
  try {
    query = validateBhql(input.query)
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
  await ctx.db((tx) =>
    tx
      .update(insightCards)
      .set({
        name: input.name.trim().slice(0, 120) || 'Untitled card',
        description: input.description?.trim().slice(0, 500) || null,
        kind: input.kind ?? 'question',
        query,
        vizType: input.vizType,
        vizSettings: input.vizSettings ?? {},
        config: input.config ?? null,
      })
      .where(eq(insightCards.id, input.id)),
  )
  revalidatePath('/insights')
  return { ok: true }
}

export async function deleteCard(id: string): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!(await ownsOrManages(ctx, id))) return { ok: false, error: 'Card not found.' }
  await ctx.db((tx) =>
    tx.update(insightCards).set({ deletedAt: new Date() }).where(eq(insightCards.id, id)),
  )
  revalidatePath('/insights')
  return { ok: true }
}

export async function publishCard(input: {
  id: string
  allowedRoles?: string[] | null
}): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!canPublishInsights(ctx) || !(await ownsOrManages(ctx, input.id))) {
    return { ok: false, error: 'Card not found.' }
  }
  await ctx.db((tx) =>
    tx
      .update(insightCards)
      .set({
        status: 'published',
        allowedRoles: input.allowedRoles && input.allowedRoles.length ? input.allowedRoles : null,
        publishedBy: ctx.userId,
        publishedAt: new Date(),
      })
      .where(eq(insightCards.id, input.id)),
  )
  revalidatePath('/insights')
  return { ok: true }
}

export async function unpublishCard(id: string): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!(await ownsOrManages(ctx, id))) return { ok: false, error: 'Card not found.' }
  await ctx.db((tx) =>
    tx
      .update(insightCards)
      .set({ status: 'draft', publishedAt: null })
      .where(and(eq(insightCards.id, id))),
  )
  revalidatePath('/insights')
  return { ok: true }
}
