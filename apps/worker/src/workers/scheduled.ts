import type { Job } from 'bullmq'
import { and, eq, isNotNull, lte, sql } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import {
  csPermits,
  documents,
  lwSessions,
  notifications,
  trainingRecords,
  users,
} from '@beaconhs/db/schema'
import { enqueueNotification, type ScheduledTick } from '@beaconhs/jobs'

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
    case 'form_assignment_scan':
    case 'report_schedule_scan':
    case 'plugin_cron':
      console.log(`[scheduled] ${job.data.kind} not yet implemented`)
      return
  }
}

async function scanCertExpiry(): Promise<void> {
  await withSuperAdmin(db, async (tx) => {
    const today = new Date()
    const buckets = [90, 30, 7, 1]
    for (const days of buckets) {
      const target = new Date(today.getTime() + days * 24 * 3600 * 1000).toISOString().slice(0, 10)
      const rows = await tx
        .select()
        .from(trainingRecords)
        .where(and(isNotNull(trainingRecords.expiresOn), eq(trainingRecords.expiresOn, target)))
      for (const r of rows) {
        console.log(`[cert_expiry] training_record ${r.id} expires in ${days}d`)
        // TODO: notify worker + supervisor
      }
    }
  })
}

async function scanCsPermitExpiry(): Promise<void> {
  await withSuperAdmin(db, async (tx) => {
    const now = new Date()
    const rows = await tx
      .update(csPermits)
      .set({ status: 'expired' })
      .where(and(eq(csPermits.status, 'active'), lte(csPermits.expiresAt, now)))
      .returning()
    if (rows.length) console.log(`[cs_permit_expiry] expired ${rows.length} permit(s)`)
  })
}

async function scanLoneWorkerOverdue(): Promise<void> {
  await withSuperAdmin(db, async (tx) => {
    const now = new Date()
    const overdue = await tx
      .select()
      .from(lwSessions)
      .where(and(eq(lwSessions.status, 'active'), lte(lwSessions.nextCheckinDueAt, now)))
    for (const s of overdue) {
      console.log(`[lone_worker] session ${s.id} overdue — escalating`)
      // Mark missed + emit a notification (notify queue is tenant-scoped)
      await tx.update(lwSessions).set({ status: 'missed' }).where(eq(lwSessions.id, s.id))
      if (s.supervisorTenantUserId) {
        // The job dispatcher resolves tenant from arg; just enqueue for the supervisor's user.
        // (Real wire: look up supervisor user, then enqueueNotification with userIds.)
      }
    }
  })
}

async function scanDocumentReview(): Promise<void> {
  await withSuperAdmin(db, async (tx) => {
    const today = new Date().toISOString().slice(0, 10)
    const rows = await tx
      .select()
      .from(documents)
      .where(and(isNotNull(documents.nextReviewOn), lte(documents.nextReviewOn, today)))
    if (rows.length) console.log(`[doc_review] ${rows.length} documents due for review`)
  })
}
