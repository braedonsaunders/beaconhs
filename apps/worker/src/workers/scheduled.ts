import type { Job } from 'bullmq'
import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import {
  correctiveActions,
  documents,
  formResponseCheckins,
  formResponses,
  notifications,
  tenantNotificationPolicy,
  tenantNotificationSettings,
  tenantUsers,
  trainingRecords,
  users,
} from '@beaconhs/db/schema'
import {
  emitCorrectiveActionOverdue,
  emitDocumentReviewDue,
  emitMonitoredSessionOverdue,
  emitTrainingExpired,
  emitTrainingExpiring,
} from '@beaconhs/events'
import { type ScheduledTick } from '@beaconhs/jobs'
import { scanReportSchedules } from '../lib/report-scheduler'
import { scanFormAssignments } from '../lib/form-assignment-scanner'
import { scanCompliance } from '../lib/compliance-scanner'
import { scanEscalations } from '../lib/escalation-scanner'
import { scanDigests } from '../lib/digest-scanner'
import { runPluginCron } from '../lib/plugin-cron'
import { runSyncConnection, scanSyncConnections } from '../lib/sync-scanner'
import { runSessionOverdueFlows } from '../lib/session-overdue-flows'

export async function processScheduledTick(job: Job<ScheduledTick>): Promise<void> {
  switch (job.data.kind) {
    case 'cert_expiry_scan':
      return scanCertExpiry()
    case 'form_session_overdue_scan':
      return scanFormSessionOverdue()
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
    case 'escalation_scan': {
      const r = await scanEscalations()
      console.log(`[scheduled] escalation_scan: ${r.escalated} escalated across ${r.tenants} tenants`)
      return
    }
    case 'digest_scan': {
      const r = await scanDigests()
      console.log(`[scheduled] digest_scan: ${r.emails} digest emails across ${r.tenants} tenants`)
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
    case 'sync_scan': {
      const r = await scanSyncConnections()
      console.log(`[scheduled] sync_scan: ${r.enqueued} enqueued / ${r.candidates} candidates`)
      return
    }
    case 'sync_run': {
      const r = await runSyncConnection(job.data.tenantId, job.data.connectionId, job.data.trigger)
      console.log(
        `[scheduled] sync_run ${job.data.connectionId.slice(0, 8)} → ${r.status} (run=${r.runId ?? 'none'})`,
      )
      return
    }
  }
}

async function scanCertExpiry(): Promise<void> {
  // Walk all the typical "reminder" buckets, plus the "already expired" bucket.
  // Each match emits an event scoped to the record's tenant.
  await withSuperAdmin(db, async (tx) => {
    // Tenants where compliance owns detection stand down here (Phase 1).
    const unified = await unifiedDetectionTenants(tx)
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
        if (unified.has(r.tenantId)) continue
        await emitTrainingExpiring(r.tenantId, r.id, days)
      }
    }

    // Newly expired today
    const expiredRows = await tx
      .select({ id: trainingRecords.id, tenantId: trainingRecords.tenantId })
      .from(trainingRecords)
      .where(and(isNotNull(trainingRecords.expiresOn), eq(trainingRecords.expiresOn, todayYmd)))
    for (const r of expiredRows) {
      if (unified.has(r.tenantId)) continue
      await emitTrainingExpired(r.tenantId, r.id)
    }
  })
}

/** Tenants that have switched detection to the compliance engine (Phase 1). */
async function unifiedDetectionTenants(tx: typeof db): Promise<Set<string>> {
  const rows = await tx
    .select({ tenantId: tenantNotificationPolicy.tenantId })
    .from(tenantNotificationPolicy)
    .where(eq(tenantNotificationPolicy.unifiedDetection, true))
  return new Set(rows.map((r) => r.tenantId))
}

// Generic monitored-session overdue scan — the Builder-app successor to
// scanLoneWorkerOverdue. A monitored response is overdue once now passes
// nextCheckinDueAt + grace; we flip it to 'escalated', log a 'missed' check-in,
// and fire the generic escalation. See docs/monitored-sessions-design.md.
async function scanFormSessionOverdue(): Promise<void> {
  await withSuperAdmin(db, async (tx) => {
    const now = new Date()
    // Compare against the DB clock (now()) — avoids worker/DB clock skew and a
    // JS Date bind param in the raw fragment.
    const overdue = await tx
      .select({
        id: formResponses.id,
        tenantId: formResponses.tenantId,
        templateId: formResponses.templateId,
        data: formResponses.data,
        submittedBy: formResponses.submittedBy,
      })
      .from(formResponses)
      .where(
        and(
          eq(formResponses.monitorStatus, 'active'),
          sql`${formResponses.nextCheckinDueAt} + ((coalesce(${formResponses.gracePeriodMinutes}, 0))::text || ' minutes')::interval <= now()`,
        ),
      )
    for (const s of overdue) {
      // Flip first so we don't re-fire next minute.
      await tx
        .update(formResponses)
        .set({ monitorStatus: 'escalated', escalatedAt: now })
        .where(eq(formResponses.id, s.id))
      await tx.insert(formResponseCheckins).values({
        tenantId: s.tenantId,
        responseId: s.id,
        kind: 'missed',
        recordedAt: now,
      })
      // Prefer the template's `session_overdue` Flow (custom escalation). If no
      // flow handles it, fall back to the built-in safety-manager/admin alert.
      let submitterEmail: string | null = null
      if (s.submittedBy) {
        const [u] = await tx
          .select({ email: users.email })
          .from(tenantUsers)
          .innerJoin(users, eq(users.id, tenantUsers.userId))
          .where(eq(tenantUsers.id, s.submittedBy))
          .limit(1)
        submitterEmail = u?.email ?? null
      }
      const flowRan = await runSessionOverdueFlows({
        tx,
        tenantId: s.tenantId,
        responseId: s.id,
        templateId: s.templateId,
        data: (s.data ?? {}) as Record<string, unknown>,
        submitterEmail,
      })
      if (!flowRan) await emitMonitoredSessionOverdue(s.tenantId, s.id)
    }
  })
}

async function scanDocumentReview(): Promise<void> {
  await withSuperAdmin(db, async (tx) => {
    const today = new Date().toISOString().slice(0, 10)
    const rows = await tx
      .select({ id: documents.id, tenantId: documents.tenantId })
      .from(documents)
      .leftJoin(
        tenantNotificationSettings,
        and(
          eq(tenantNotificationSettings.tenantId, documents.tenantId),
          eq(tenantNotificationSettings.category, 'document'),
        ),
      )
      .where(
        and(
          isNotNull(documents.nextReviewOn),
          lte(documents.nextReviewOn, today),
          inArray(documents.status, ['draft', 'published', 'under_review']),
          // Stand down where compliance owns detection (Phase 1).
          sql`not exists (select 1 from ${tenantNotificationPolicy} p where p.tenant_id = ${documents.tenantId} and p.unified_detection = true)`,
          // Respect the tenant's /admin/notifications config: skip if muted, and
          // re-alert at most once per configured window (default 24h) so a doc
          // that stays overdue for review doesn't ping daily forever.
          sql`coalesce(${tenantNotificationSettings.enabled}, true) = true`,
          sql`not exists (
            select 1 from ${notifications} n
            where n.type = 'document.review_due'
              and n.data->>'documentId' = ${documents.id}::text
              and n.occurred_at >= now() - ((coalesce(${tenantNotificationSettings.reminderHours}, 24))::text || ' hours')::interval
          )`,
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
      .leftJoin(
        tenantNotificationSettings,
        and(
          eq(tenantNotificationSettings.tenantId, correctiveActions.tenantId),
          eq(tenantNotificationSettings.category, 'ca'),
        ),
      )
      .where(
        and(
          isNotNull(correctiveActions.dueOn),
          sql`${correctiveActions.dueOn} < ${today}`,
          inArray(correctiveActions.status, ['open', 'in_progress']),
          // Stand down where compliance owns detection (Phase 1).
          sql`not exists (select 1 from ${tenantNotificationPolicy} p where p.tenant_id = ${correctiveActions.tenantId} and p.unified_detection = true)`,
          // Skip tenants that muted CA alerts in /admin/notifications.
          sql`coalesce(${tenantNotificationSettings.enabled}, true) = true`,
          // De-dupe: this tick runs hourly, but without a guard every overdue CA
          // would re-notify its whole audience (owner + assigner + safety
          // managers/admins) on every single run. Skip any CA already alerted
          // within the tenant's configured reminder window (default 24h), so a
          // still-overdue CA nudges at most that often instead of once an hour.
          sql`not exists (
            select 1 from ${notifications} n
            where n.type = 'ca.overdue'
              and n.data->>'caId' = ${correctiveActions.id}::text
              and n.occurred_at >= now() - ((coalesce(${tenantNotificationSettings.reminderHours}, 24))::text || ' hours')::interval
          )`,
        ),
      )
    for (const c of rows) {
      await emitCorrectiveActionOverdue(c.tenantId, c.id)
    }
  })
}
