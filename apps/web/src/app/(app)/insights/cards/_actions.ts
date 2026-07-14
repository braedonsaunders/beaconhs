'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import {
  parseBhqlQuery,
  resultShapeOf,
  suggestViz,
  type BhqlResult,
  type ResultColumn,
  type VizKey,
} from '@beaconhs/analytics'
import { runBhql } from '@beaconhs/analytics/server'
import { insightCards, type BhqlQuery, type InsightCardConfig } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiConfig } from '@/lib/ai-config'
import { recordAudit, recordAuditInTransaction } from '@/lib/audit'
import { resolveAnalyticsAccess, runAuthorizedBhql } from '@/lib/analytics-access'
import { canCreateInsights, canPublishInsights } from '../_access'
import { generateBhqlFromPrompt } from './_lib/ai-card'
import { isUuid } from '@/lib/list-params'
import {
  INSIGHT_CARD_DESCRIPTION_MAX_LENGTH,
  INSIGHT_CARD_NAME_MAX_LENGTH,
  validateOptionalPersistedText,
  validateRequiredPersistedText,
} from '@/lib/persisted-text-policy'

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

/** Run a draft query live for the builder preview (row-capped, under RLS).
 *  Builder-only: this executes an arbitrary client-supplied query (including
 *  raw-row projections over any registry entity), so it is gated exactly like
 *  the studio that calls it — view access alone is not enough. */
export async function previewCard(payload: {
  query: unknown
}): Promise<Ok<{ result: BhqlResult; suggestedViz: VizKey }> | Err> {
  const ctx = await requireRequestContext()
  if (!canCreateInsights(ctx)) return { ok: false, error: 'You can’t create Cards.' }
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'Invalid query.' }
  try {
    const result = await ctx.db(async (tx) => {
      const access = await resolveAnalyticsAccess(ctx, tx)
      const query = parseBhqlQuery(payload.query, access.entityMap)
      return runBhql(tx, query, { maxRows: 1000, entityMap: access.entityMap })
    })
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
  if (typeof prompt !== 'string' || prompt.length > 8_000) {
    return { ok: false, error: 'The request is invalid or too large.' }
  }
  const trimmed = prompt.trim()
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
    const result = await runAuthorizedBhql(ctx, query, { maxRows: 1000 })
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
  kind?: 'question' | 'ai' | 'metric'
  config?: InsightCardConfig | null
}): Promise<Ok<{ id: string }> | Err> {
  const ctx = await requireRequestContext()
  if (!canCreateInsights(ctx)) return { ok: false, error: 'You can’t create Cards.' }
  if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid Card.' }
  const parsedName = validateRequiredPersistedText(input.name, {
    label: 'Card name',
    maxLength: INSIGHT_CARD_NAME_MAX_LENGTH,
  })
  if (!parsedName.ok) return parsedName
  const parsedDescription = validateOptionalPersistedText(input.description, {
    label: 'Card description',
    maxLength: INSIGHT_CARD_DESCRIPTION_MAX_LENGTH,
  })
  if (!parsedDescription.ok) return parsedDescription
  try {
    const row = await ctx.db(async (tx) => {
      const access = await resolveAnalyticsAccess(ctx, tx)
      const query = parseBhqlQuery(input.query, access.entityMap)
      const [created] = await tx
        .insert(insightCards)
        .values({
          tenantId: ctx.tenantId,
          createdBy: ctx.userId,
          name: parsedName.value,
          description: parsedDescription.value,
          kind: input.kind ?? 'question',
          query,
          vizType: input.vizType,
          vizSettings: input.vizSettings ?? {},
          config: input.config ?? null,
        })
        .returning({ id: insightCards.id })
      if (!created) throw new Error('Could not create the Card.')
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'insight_card',
        entityId: created.id,
        action: 'create',
        summary: `Created Insights card "${parsedName.value}"`,
      })
      return created
    })
    revalidatePath('/insights')
    return { ok: true, id: row.id }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
}

/** The live (non-deleted) card, when the caller may manage it (owner or
 *  super-admin). Soft-deleted cards are invisible to every mutation. */
async function ownedCard(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  id: string,
): Promise<{ name: string } | null> {
  const [row] = await ctx.db((tx) =>
    tx
      .select({ createdBy: insightCards.createdBy, name: insightCards.name })
      .from(insightCards)
      .where(and(eq(insightCards.id, id), isNull(insightCards.deletedAt)))
      .limit(1),
  )
  if (!row) return null
  return ctx.isSuperAdmin || row.createdBy === ctx.userId ? { name: row.name } : null
}

export async function updateCard(input: {
  id: string
  name: string
  description?: string
  query: unknown
  vizType: string
  vizSettings?: Record<string, unknown>
  kind?: 'question' | 'ai' | 'metric'
  config?: InsightCardConfig | null
}): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!canCreateInsights(ctx)) return { ok: false, error: 'You can’t edit Cards.' }
  if (!input || typeof input !== 'object' || !isUuid(input.id)) {
    return { ok: false, error: 'Card not found.' }
  }
  const parsedName = validateRequiredPersistedText(input.name, {
    label: 'Card name',
    maxLength: INSIGHT_CARD_NAME_MAX_LENGTH,
  })
  if (!parsedName.ok) return parsedName
  const parsedDescription = validateOptionalPersistedText(input.description, {
    label: 'Card description',
    maxLength: INSIGHT_CARD_DESCRIPTION_MAX_LENGTH,
  })
  if (!parsedDescription.ok) return parsedDescription
  try {
    const updated = await ctx.db(async (tx) => {
      const [card] = await tx
        .select({ createdBy: insightCards.createdBy })
        .from(insightCards)
        .where(and(eq(insightCards.id, input.id), isNull(insightCards.deletedAt)))
        .limit(1)
        .for('update')
      if (!card || (!ctx.isSuperAdmin && card.createdBy !== ctx.userId)) return false

      const access = await resolveAnalyticsAccess(ctx, tx)
      const query = parseBhqlQuery(input.query, access.entityMap)
      const name = parsedName.value
      const [row] = await tx
        .update(insightCards)
        .set({
          name,
          description: parsedDescription.value,
          kind: input.kind ?? 'question',
          query,
          vizType: input.vizType,
          vizSettings: input.vizSettings ?? {},
          config: input.config ?? null,
        })
        .where(and(eq(insightCards.id, input.id), isNull(insightCards.deletedAt)))
        .returning({ id: insightCards.id })
      if (!row) return false
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'insight_card',
        entityId: input.id,
        action: 'update',
        summary: `Updated Insights card "${name}"`,
      })
      return true
    })
    if (!updated) return { ok: false, error: 'Card not found.' }
  } catch (e) {
    return { ok: false, error: errMsg(e) }
  }
  revalidatePath('/insights')
  return { ok: true }
}

export async function deleteCard(id: string): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!canCreateInsights(ctx)) return { ok: false, error: 'You can’t delete Cards.' }
  const card = await ownedCard(ctx, id)
  if (!card) return { ok: false, error: 'Card not found.' }
  await ctx.db((tx) =>
    tx.update(insightCards).set({ deletedAt: new Date() }).where(eq(insightCards.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'insight_card',
    entityId: id,
    action: 'delete',
    summary: `Deleted Insights card "${card.name}"`,
  })
  revalidatePath('/insights')
  return { ok: true }
}

export async function publishCard(input: {
  id: string
  allowedRoles?: string[] | null
}): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!canPublishInsights(ctx)) return { ok: false, error: 'You can’t publish Cards.' }
  const card = await ownedCard(ctx, input.id)
  if (!card) return { ok: false, error: 'Card not found.' }
  const allowedRoles = input.allowedRoles && input.allowedRoles.length ? input.allowedRoles : null
  await ctx.db((tx) =>
    tx
      .update(insightCards)
      .set({
        status: 'published',
        allowedRoles,
        publishedBy: ctx.userId,
        publishedAt: new Date(),
      })
      .where(eq(insightCards.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'insight_card',
    entityId: input.id,
    action: 'publish',
    summary: `Published Insights card "${card.name}" to the library`,
    metadata: { allowedRoles },
  })
  revalidatePath('/insights')
  return { ok: true }
}

export async function unpublishCard(id: string): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!canPublishInsights(ctx)) return { ok: false, error: 'You can’t unpublish Cards.' }
  const card = await ownedCard(ctx, id)
  if (!card) return { ok: false, error: 'Card not found.' }
  await ctx.db((tx) =>
    tx
      .update(insightCards)
      .set({ status: 'draft', publishedAt: null })
      .where(eq(insightCards.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'insight_card',
    entityId: id,
    action: 'update',
    summary: `Unpublished Insights card "${card.name}"`,
  })
  revalidatePath('/insights')
  return { ok: true }
}
