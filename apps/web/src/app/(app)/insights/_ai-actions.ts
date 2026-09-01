'use server'

// Insights AI: stored journal-analysis snapshots (worker-written) plus on-demand
// dataset cards. Journal analysis never runs on a page request.

import { and, desc, eq, inArray } from 'drizzle-orm'
import { analyseDataset, type DatasetAnalysis, type JournalAnalysis } from '@beaconhs/ai'
import {
  journalAnalysisRuns,
  type AiCardConfig,
  type JournalAnalysisResult,
} from '@beaconhs/db/schema'
import {
  enqueueAiJob,
  JOURNAL_ANALYSIS_PERIODS,
  isJournalAnalysisPeriod,
  type JournalAnalysisPeriod,
} from '@beaconhs/jobs'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiConfig } from '@/lib/ai-config'
import { recordAudit } from '@/lib/audit'
import { runAuthorizedBhql } from '@/lib/analytics-access'
import { canViewInsights } from './_access'
import { loadCard } from './cards/_data'
import { isUuid } from '@/lib/list-params'

export type JournalAnalysisSnapshot = {
  days: JournalAnalysisPeriod
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'empty'
  analysis: JournalAnalysis | null
  entryCount: number
  finishedAt: string | null
  error: string | null
}

function asAnalysis(result: JournalAnalysisResult | null): JournalAnalysis | null {
  if (!result || typeof result.summary !== 'string') return null
  return result as JournalAnalysis
}

export async function loadJournalAnalysisSnapshot(): Promise<JournalAnalysisSnapshot[]> {
  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) return []
  const rows = await ctx.db((tx) =>
    tx
      .select({
        days: journalAnalysisRuns.days,
        status: journalAnalysisRuns.status,
        result: journalAnalysisRuns.result,
        entryCount: journalAnalysisRuns.entryCount,
        finishedAt: journalAnalysisRuns.finishedAt,
        error: journalAnalysisRuns.error,
        createdAt: journalAnalysisRuns.createdAt,
      })
      .from(journalAnalysisRuns)
      .where(inArray(journalAnalysisRuns.days, [...JOURNAL_ANALYSIS_PERIODS]))
      .orderBy(desc(journalAnalysisRuns.createdAt)),
  )
  return JOURNAL_ANALYSIS_PERIODS.map((days) => {
    const row = rows.find((r) => r.days === days)
    if (!row) {
      return {
        days,
        status: 'empty',
        analysis: null,
        entryCount: 0,
        finishedAt: null,
        error: null,
      }
    }
    return {
      days,
      status: row.status,
      analysis: asAnalysis(row.result),
      entryCount: row.entryCount,
      finishedAt: row.finishedAt?.toISOString() ?? row.createdAt.toISOString(),
      error: row.error,
    }
  })
}

export async function enqueueJournalAnalysis(
  days: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) {
    return { ok: false, error: 'You do not have access to insights.' }
  }
  if (!isJournalAnalysisPeriod(days)) {
    return { ok: false, error: 'Choose 7, 30, or 90 days.' }
  }
  const aiConfig = await getTenantAiConfig(ctx)
  if (!aiConfig) return { ok: false, error: 'AI is not configured. Set it up under Admin → AI.' }

  const existing = await ctx.db((tx) =>
    tx
      .select({ id: journalAnalysisRuns.id, status: journalAnalysisRuns.status })
      .from(journalAnalysisRuns)
      .where(and(eq(journalAnalysisRuns.days, days)))
      .orderBy(desc(journalAnalysisRuns.createdAt))
      .limit(1),
  )
  const current = existing[0]
  if (!current || (current.status !== 'pending' && current.status !== 'running')) {
    await ctx.db((tx) =>
      tx.insert(journalAnalysisRuns).values({
        tenantId: ctx.tenantId,
        days,
        status: 'pending',
        createdByTenantUserId: ctx.membership?.id ?? null,
      }),
    )
  }
  await enqueueAiJob({ kind: 'journal_analysis_run', tenantId: ctx.tenantId, days })
  await recordAudit(ctx, {
    entityType: 'journal_entry',
    action: 'export',
    summary: `Queued AI journal analysis (${days}d)`,
    metadata: { days },
  })
  return { ok: true }
}

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
