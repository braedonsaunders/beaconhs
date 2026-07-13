'use server'

// On-demand bulk AI analysis of recent journals for the Insights "AI journal
// analysis" widget: sentiment, surfaced issues and recommended corrective
// actions. Scoped exactly like the journal reads (self / site / all).

import { and, desc, eq, gte, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  analyseDataset,
  analyseJournals,
  type DatasetAnalysis,
  type JournalAnalysis,
} from '@beaconhs/ai'
import { journalEntries, orgUnits, people, type AiCardConfig } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiConfig } from '@/lib/ai-config'
import { recordAudit } from '@/lib/audit'
import { runAuthorizedBhql } from '@/lib/analytics-access'
import { getAuthorPersonId, journalScopeWhere } from '../journals/_lib'
import { canViewInsights } from './_access'
import { loadCard } from './cards/_data'
import { isUuid } from '@/lib/list-params'

const analysisAuthor = alias(people, 'analysis_author')

type JournalAnalysisResult =
  | { ok: true; analysis: JournalAnalysis; entryCount: number; days: number }
  | { ok: false; error: string }

export async function runJournalAnalysis(days = 30): Promise<JournalAnalysisResult> {
  const ctx = await requireRequestContext()
  // Gate matches the surface that exposes the widget (canViewInsights); the
  // journal-level scoping below still bounds WHICH entries the caller can read.
  if (!canViewInsights(ctx)) {
    return { ok: false, error: 'You do not have access to insights.' }
  }
  const aiConfig = await getTenantAiConfig(ctx)
  if (!aiConfig) return { ok: false, error: 'AI is not configured. Set it up under Admin → AI.' }

  const safeDays = Number.isFinite(days) ? Math.min(370, Math.max(1, Math.floor(days))) : 30
  const since = new Date(Date.now() - safeDays * 86_400_000).toISOString().slice(0, 10)
  const authorPersonId = await getAuthorPersonId(ctx)
  const scope = journalScopeWhere(ctx, authorPersonId)

  const rows = await ctx.db((tx) =>
    tx
      .select({
        date: journalEntries.entryDate,
        text: journalEntries.bodyText,
        site: orgUnits.name,
        first: analysisAuthor.firstName,
        last: analysisAuthor.lastName,
      })
      .from(journalEntries)
      .leftJoin(orgUnits, eq(orgUnits.id, journalEntries.siteOrgUnitId))
      .leftJoin(analysisAuthor, eq(analysisAuthor.id, journalEntries.personId))
      .where(
        and(
          isNull(journalEntries.deletedAt),
          gte(journalEntries.entryDate, since),
          ...(scope ? [scope] : []),
        ),
      )
      .orderBy(desc(journalEntries.entryDate))
      .limit(200),
  )

  const entries = rows
    .filter((r) => (r.text ?? '').trim().length > 0)
    .map((r) => ({
      date: r.date,
      site: r.site,
      author: r.first ? `${r.first} ${r.last ?? ''}`.trim() : null,
      text: (r.text ?? '').slice(0, 800),
    }))
  if (entries.length === 0) {
    return { ok: false, error: 'No journal entries in this period to analyse.' }
  }

  const analysis = await analyseJournals(aiConfig, {
    scope: safeDays <= 7 ? 'past week' : safeDays <= 31 ? 'past 30 days' : 'period',
    entries,
  })
  if (!analysis) return { ok: false, error: 'Could not analyse the journals.' }

  await recordAudit(ctx, {
    entityType: 'journal_entry',
    action: 'export',
    summary: `AI-analysed ${entries.length} journal entries`,
    metadata: { days: safeDays },
  })
  return { ok: true, analysis, entryCount: entries.length, days: safeDays }
}

export type InsightAiResult =
  | { ok: true; analysis: DatasetAnalysis; rowCount: number }
  | { ok: false; error: string }

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
