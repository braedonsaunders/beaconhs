'use server'

// Insights AI cards: analyse a card's BHQL dataset on demand under its stored
// instruction. Scheduled, cited analyses are AI briefs (Reports → AI briefs).

import { analyseDataset, type DatasetAnalysis } from '@beaconhs/ai'
import type { AiCardConfig } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiConfig } from '@/lib/ai-config'
import { recordAudit } from '@/lib/audit'
import { runAuthorizedBhql } from '@/lib/analytics-access'
import { canViewInsights } from './_access'
import { loadCard } from './cards/_data'
import { isUuid } from '@/lib/list-params'

export type InsightAiResult =
  { ok: true; analysis: DatasetAnalysis; rowCount: number } | { ok: false; error: string }

/** Run an Insights AI card on demand: execute its BHQL dataset under RLS, then
 *  have the tenant's model analyse the rows under the card's stored instruction. */
export async function runInsightAiCard(cardId: string): Promise<InsightAiResult> {
  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) return { ok: false, error: 'You do not have access to insights.' }
  if (!isUuid(cardId)) return { ok: false, error: 'Card not found.' }
  const aiConfig = await getTenantAiConfig(ctx)
  if (!aiConfig) return { ok: false, error: 'AI is not configured. Set it up under Admin → AI.' }

  // loadCard applies the same visibility every other reader enforces: the
  // caller's own cards, or published cards their roles are allowed to see.
  const card = await loadCard(ctx, cardId)
  if (!card) return { ok: false, error: 'Card not found.' }
  if (card.kind !== 'ai') return { ok: false, error: 'This card is not an AI card.' }
  const cfg = card.config as AiCardConfig | null
  if (!cfg || cfg.kind !== 'ai' || !cfg.prompt.trim()) {
    return { ok: false, error: 'This AI card has no instruction configured.' }
  }

  let result
  try {
    result = await runAuthorizedBhql(ctx, card.query, { maxRows: 5_000 })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not run the card dataset.' }
  }
  if (result.shape !== 'flat') {
    return {
      ok: false,
      error: 'AI cards analyse a table dataset — set the card display to a table.',
    }
  }
  if (result.rows.length === 0) return { ok: false, error: 'No data in this period to analyse.' }

  const analysis = await analyseDataset(aiConfig, {
    instruction: cfg.prompt,
    columns: result.columns.map((c) => ({ key: c.key, label: c.label })),
    rows: result.rows,
  })
  if (!analysis) return { ok: false, error: 'Could not analyse this dataset.' }
  await recordAudit(ctx, {
    entityType: 'insight_card',
    entityId: cardId,
    action: 'export',
    summary: `Sent ${result.rows.length} Insights rows for AI analysis`,
    metadata: { rowCount: result.rows.length },
  })
  return { ok: true, analysis, rowCount: result.rows.length }
}
