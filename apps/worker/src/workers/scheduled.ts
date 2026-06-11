import type { Job } from 'bullmq'
import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import {
  correctiveActions,
  csPermits,
  documents,
  lwSessions,
  trainingRecords,
} from '@beaconhs/db/schema'
import {
  emitCorrectiveActionOverdue,
  emitCsPermitExpiring,
  emitDocumentReviewDue,
  emitLoneWorkerOverdue,
  emitTrainingExpired,
  emitTrainingExpiring,
} from '@beaconhs/events'
import { type ScheduledTick } from '@beaconhs/jobs'
import { scanReportSchedules } from '../lib/report-scheduler'
import { scanFormAssignments } from '../lib/form-assignment-scanner'
import { scanCompliance } from '../lib/compliance-scanner'
import { runPluginCron } from '../lib/plugin-cron'
import { runImport, ALL_LOADERS } from '@beaconhs/etl'

export async function processScheduledTick(job: Job<ScheduledTick>): Promise<void> {
  switch (job.data.kind) {
    case 'cert_expiry_scan':
      return scanCertExpiry()
    case 'cs_permit_expiry_scan':
      return scanCsPermitExpiry()
    case 'lone_worker_overdue_scan':
      return scanLoneWorkerOverdue()
    case 'document_review_scan':
      return scanDocumentReview()
    case 'ca_overdue_scan':
      return scanCorrectiveActionOverdue()
    case 'compliance_scan': {
      const r = await scanCompliance()
      console.log(
        `[scheduled] compliance_scan: ${r.obligations} obligations across ${r.tenants} tenants / ${r.reminders} reminders / ${r.errors} errors`,
      )
      return
    }
    case 'report_schedule_scan':
      return scanReportSchedules()
    case 'form_assignment_scan': {
      const r = await scanFormAssignments()
      console.log(
        `[scheduled] form_assignment_scan: ${r.dispatched} dispatched / ${r.skipped} skipped / ${r.errors} errors (${r.candidates} candidates)`,
      )
      return
    }
    case 'plugin_cron': {
      const cadence = job.data.cadence ?? 'hourly'
      const r = await runPluginCron(cadence)
      console.log(
        `[scheduled] plugin_cron(${cadence}): candidates=${r.candidates} recorded=${r.recorded} errors=${r.errors}`,
      )
      return
    }
    case 'report_run':
      console.log(
        '[scheduled] report_run tick is a no-op (per-run dispatch handled by reports queue)',
      )
      return
    case 'etl_mssql_sync': {
      if (!process.env.ETL_SOURCE_URL) {
        console.log('[scheduled] etl_mssql_sync skipped: ETL_SOURCE_URL not configured')
        return
      }
      const stats = await runImport(ALL_LOADERS, { mode: 'sync' })
      const total = stats.reduce((a, s) => a + s.upserted, 0)
      console.log(
        `[scheduled] etl_mssql_sync: ${total} rows upserted across ${stats.length} entities`,
      )
      return
    }
  }
}

async function scanCertExpiry(): Promise<void> {
  // Walk all the typical "reminder" buckets, plus the "already expired" bucket.
  // Each match emits an event scoped to the record's tenant.
  await withSuperAdmin(db, async (tx) => {
    const today = new Date()
    const todayYmd = today.toISOString().slice(0, 10)
    const buckets = [90, 30, 7, 1]
    for (const days of buckets) {
      const target = new Date(today.getTime() + days * 24 * 3600 * 1000).toISOString().slice(0, 10)
      const rows = await tx
        .select({ id: trainingRecords.id, tenantId: trainingRecords.tenantId })
        .from(trainingRecords)
        .where(and(isNotNull(trainingRecords.expiresOn), eq(trainingRecords.expiresOn, target)))
      for (const r of rows) {
        await emitTrainingExpiring(r.tenantId, r.id, days)
      }
    }

    // Newly expired today
    const expiredRows = await tx
      .select({ id: trainingRecords.id, tenantId: trainingRecords.tenantId })
      .from(trainingRecords)
      .where(and(isNotNull(trainingRecords.expiresOn), eq(trainingRecords.expiresOn, todayYmd)))
    for (const r of expiredRows) {
      await emitTrainingExpired(r.tenantId, r.id)
    }
  })
}

async function scanCsPermitExpiry(): Promise<void> {
  // 1. Notify on permits expiring soon (within 24 hours) before marking expired
  // 2. Mark active permits past expiry as 'expired'
  await withSuperAdmin(db, async (tx) => {
    const now = new Date()
    const in24h = new Date(now.getTime() + 24 * 3600 * 1000)
    const expiringSoon = await tx
      .select({ id: csPermits.id, tenantId: csPermits.tenantId, expiresAt: csPermits.expiresAt })
      .from(csPermits)
      .where(and(eq(csPermits.status, 'active'), lte(csPermits.expiresAt, in24h)))
    for (const p of expiringSoon) {
      if (p.expiresAt > now) {
        await emitCsPermitExpiring(p.tenantId, p.id)
      }
    }

    const expired = await tx
      .update(csPermits)
      .set({ status: 'expired' })
      .where(and(eq(csPermits.status, 'active'), lte(csPermits.expiresAt, now)))
      .returning({ id: csPermits.id })
    if (expired.length) console.log(`[cs_permit_expiry] expired ${expired.length} permit(s)`)
  })
}

async function scanLoneWorkerOverdue(): Promise<void> {
  await withSuperAdmin(db, async (tx) => {
    const now = new Date()
    const overdue = await tx
      .select({
        id: lwSessions.id,
        tenantId: lwSessions.tenantId,
      })
      .from(lwSessions)
      .where(and(eq(lwSessions.status, 'active'), lte(lwSessions.nextCheckinDueAt, now)))
    for (const s of overdue) {
      // Mark missed first so we don't re-fire next minute
      await tx.update(lwSessions).set({ status: 'missed' }).where(eq(lwSessions.id, s.id))
      await emitLoneWorkerOverdue(s.tenantId, s.id)
    }
  })
}

async function scanDocumentReview(): Promise<void> {
  await withSuperAdmin(db, async (tx) => {
    const today = new Date().toISOString().slice(0, 10)
    const rows = await tx
      .select({ id: documents.id, tenantId: documents.tenantId })
      .from(documents)
      .where(
        and(
          isNotNull(documents.nextReviewOn),
          lte(documents.nextReviewOn, today),
          inArray(documents.status, ['draft', 'published', 'under_review']),
        ),
      )
    for (const d of rows) {
      await emitDocumentReviewDue(d.tenantId, d.id)
    }
  })
}

async function scanCorrectiveActionOverdue(): Promise<void> {
  // CAs whose due date has passed and that are still open/in_progress.
  // We use the dueOn date column (text 'YYYY-MM-DD') compared to today.
  await withSuperAdmin(db, async (tx) => {
    const today = new Date().toISOString().slice(0, 10)
    const rows = await tx
      .select({ id: correctiveActions.id, tenantId: correctiveActions.tenantId })
      .from(correctiveActions)
      .where(
        and(
          isNotNull(correctiveActions.dueOn),
          sql`${correctiveActions.dueOn} < ${today}`,
          inArray(correctiveActions.status, ['open', 'in_progress']),
        ),
      )
    for (const c of rows) {
      await emitCorrectiveActionOverdue(c.tenantId, c.id)
    }
  })
}
