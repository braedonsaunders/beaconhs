import type { Job } from 'bullmq'
import { and, eq, sql } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { formResponseCheckins, formResponses, tenantUsers, users } from '@beaconhs/db/schema'
import { type ScheduledTick } from '@beaconhs/jobs'
import { scanReportSchedules } from '../lib/report-scheduler'
import { scanFormAssignments } from '../lib/form-assignment-scanner'
import { scanCompliance } from '../lib/compliance-scanner'
import { scanEscalations } from '../lib/escalation-scanner'
import { scanDigests } from '../lib/digest-scanner'
import { scanScheduledFlows } from '../lib/scheduled-flow-runner'
import { runPluginCron } from '../lib/plugin-cron'
import { runSyncConnection, scanSyncConnections } from '../lib/sync-scanner'
import { runSessionOverdueFlows } from '../lib/session-overdue-flows'

export async function processScheduledTick(job: Job<ScheduledTick>): Promise<void> {
  switch (job.data.kind) {
    case 'form_session_overdue_scan':
      return scanFormSessionOverdue()
    case 'compliance_scan': {
      const r = await scanCompliance()
      console.log(
        `[scheduled] compliance_scan: ${r.obligations} obligations across ${r.tenants} tenants / ${r.reminders} reminders / ${r.errors} errors`,
      )
      return
    }
    case 'escalation_scan': {
      const r = await scanEscalations()
      console.log(
        `[scheduled] escalation_scan: ${r.escalated} escalated across ${r.tenants} tenants`,
      )
      return
    }
    case 'digest_scan': {
      const r = await scanDigests()
      console.log(`[scheduled] digest_scan: ${r.emails} digest emails across ${r.tenants} tenants`)
      return
    }
    case 'scheduled_flow_scan': {
      const r = await scanScheduledFlows()
      if (r.flows > 0)
        console.log(`[scheduled] scheduled_flow_scan: ${r.flows} flows fired / ${r.ran} actions`)
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
      // Alerting is the monitored app's own session_overdue Flow — a Builder app
      // is per-tenant + dynamic, so the worker doesn't hardcode a fallback
      // audience. (Detection above — status flip + missed check-in — is generic.)
      await runSessionOverdueFlows({
        tx,
        tenantId: s.tenantId,
        responseId: s.id,
        templateId: s.templateId,
        data: (s.data ?? {}) as Record<string, unknown>,
        submitterEmail,
      })
    }
  })
}

// Cert expiry, document review, and corrective-action overdue are NOT scanned
// here — the compliance obligation engine is the single detector for recurring
// due/overdue/expiry conditions (see compliance-scanner.ts). Monitored-session
// overdue stays: it's a distinct real-time check-in concern, not a duplicate.
