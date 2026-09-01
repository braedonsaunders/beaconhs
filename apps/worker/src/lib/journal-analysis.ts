import { and, desc, eq, gte, isNull } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { analyseJournals } from '@beaconhs/ai'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { journalAnalysisRuns, journalEntries, orgUnits, people, tenants } from '@beaconhs/db/schema'
import { enqueueAiJob, JOURNAL_ANALYSIS_PERIODS, type JournalAnalysisPeriod } from '@beaconhs/jobs'
import { resolveTenantAiConfig, tenantWantsAutomaticJournalAnalysis } from './tenant-ai-config'

const analysisAuthor = alias(people, 'analysis_author')

const STALE_AFTER_MS: Record<JournalAnalysisPeriod, number> = {
  7: 4 * 60 * 60 * 1000,
  30: 12 * 60 * 60 * 1000,
  90: 24 * 60 * 60 * 1000,
}

export async function scanJournalAnalysis(): Promise<{ enqueued: number; tenants: number }> {
  const tenantRows = await withSuperAdmin(db, (tx) =>
    tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, 'active')),
  )
  let enqueued = 0
  for (const tenant of tenantRows) {
    if (!(await tenantWantsAutomaticJournalAnalysis(tenant.id))) continue
    if (!(await resolveTenantAiConfig(tenant.id))) continue
    for (const days of JOURNAL_ANALYSIS_PERIODS) {
      if (await enqueueIfStale(tenant.id, days)) enqueued += 1
    }
  }
  return { enqueued, tenants: tenantRows.length }
}

async function enqueueIfStale(tenantId: string, days: JournalAnalysisPeriod): Promise<boolean> {
  const now = Date.now()
  const latest = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        status: journalAnalysisRuns.status,
        createdAt: journalAnalysisRuns.createdAt,
        finishedAt: journalAnalysisRuns.finishedAt,
      })
      .from(journalAnalysisRuns)
      .where(and(eq(journalAnalysisRuns.days, days)))
      .orderBy(desc(journalAnalysisRuns.createdAt))
      .limit(1),
  )
  const row = latest[0]
  if (row && (row.status === 'pending' || row.status === 'running')) return false
  if (row?.status === 'succeeded' && row.finishedAt) {
    if (now - row.finishedAt.getTime() < STALE_AFTER_MS[days]) return false
  }
  await enqueueAiJob({ kind: 'journal_analysis_run', tenantId, days })
  return true
}

export async function runJournalAnalysisJob(tenantId: string, days: JournalAnalysisPeriod) {
  const aiConfig = await resolveTenantAiConfig(tenantId)
  const runId = await withTenant(db, tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: journalAnalysisRuns.id, status: journalAnalysisRuns.status })
      .from(journalAnalysisRuns)
      .where(and(eq(journalAnalysisRuns.days, days), eq(journalAnalysisRuns.status, 'pending')))
      .orderBy(desc(journalAnalysisRuns.createdAt))
      .limit(1)
    if (existing) {
      await tx
        .update(journalAnalysisRuns)
        .set({ status: 'running', startedAt: new Date(), error: null })
        .where(eq(journalAnalysisRuns.id, existing.id))
      return existing.id
    }
    const [created] = await tx
      .insert(journalAnalysisRuns)
      .values({
        tenantId,
        days,
        status: 'running',
        startedAt: new Date(),
      })
      .returning({ id: journalAnalysisRuns.id })
    return created?.id ?? null
  })
  if (!runId) throw new Error('Could not open a journal analysis run')

  const fail = async (error: string) => {
    await withTenant(db, tenantId, (tx) =>
      tx
        .update(journalAnalysisRuns)
        .set({ status: 'failed', error, finishedAt: new Date() })
        .where(eq(journalAnalysisRuns.id, runId)),
    )
  }

  if (!aiConfig) {
    await fail('AI is not configured for this workspace.')
    return
  }

  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const rows = await withTenant(db, tenantId, (tx) =>
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
      .where(and(isNull(journalEntries.deletedAt), gte(journalEntries.entryDate, since)))
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
    await fail('No journal entries in this period to analyse.')
    return
  }

  const analysis = await analyseJournals(aiConfig, {
    scope: days <= 7 ? 'past week' : days <= 31 ? 'past 30 days' : 'period',
    entries,
  })
  if (!analysis) {
    await fail('Could not analyse the journals.')
    return
  }

  await withTenant(db, tenantId, (tx) =>
    tx
      .update(journalAnalysisRuns)
      .set({
        status: 'succeeded',
        entryCount: entries.length,
        result: analysis,
        error: null,
        finishedAt: new Date(),
      })
      .where(eq(journalAnalysisRuns.id, runId)),
  )
}
