import type { Job } from 'bullmq'
import { and, asc, eq, gt, or, sql } from 'drizzle-orm'
import {
  db,
  isFormResponseParentLockedError,
  lockFormResponseForMutation,
  withSuperAdmin,
} from '@beaconhs/db'
import { formResponseCheckins, formResponses, tenantUsers, users } from '@beaconhs/db/schema'
import { assertScheduledTick, type ScheduledTick } from '@beaconhs/jobs'
import { scanReportSchedules } from '../lib/report-scheduler'
import { scanCompliance } from '../lib/compliance-scanner'
import { scanEscalations } from '../lib/escalation-scanner'
import { scanDigests } from '../lib/digest-scanner'
import { scanScheduledFlows } from '../lib/scheduled-flow-runner'
import { runSyncConnection, scanSyncConnections } from '../lib/sync-scanner'
import { runSessionOverdueFlows } from '../lib/session-overdue-flows'
import { runDatabaseMaintenance } from '../lib/db-maintenance'
import { drainDomainEventOutbox } from '../lib/domain-event-outbox'
import { reconcileOfficeRenders } from '../lib/office-render-reconciler'
import { drainStorageObjectDeletionOutbox } from '../lib/storage-object-deletion-outbox'
import { reconcileExpiredAttachmentUploads } from '../lib/attachment-upload-reconciler'

export async function processScheduledTick(job: Job<ScheduledTick>): Promise<void> {
  assertScheduledTick(job.data)
  switch (job.data.kind) {
    case 'form_session_overdue_scan':
      return scanFormSessionOverdue()
    case 'compliance_scan': {
      // Evaluate tenant crons against the tick's SCHEDULED minute (timestamp +
      // delay = the BullMQ repeat slot), so late processing or a retry never
      // silently skips a tenant whose scan matched the intended minute.
      const slotMs = job.timestamp + (job.opts.delay ?? 0)
      const r = await scanCompliance(Number.isFinite(slotMs) ? new Date(slotMs) : new Date())
      // Runs every minute now (per-tenant self-gating); only log when work happened.
      if (r.due > 0 || r.errors > 0) {
        console.log(
          `[scheduled] compliance_scan: ${r.due}/${r.tenants} tenants due / ${r.obligations} obligations / ${r.reminders} reminders / ${r.maintenance} maintenance / ${r.errors} errors`,
        )
      }
      if (r.errors > 0) {
        throw new Error(`Compliance scan completed with ${r.errors} tenant or dispatch error(s)`)
      }
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
      const slotMs = job.timestamp + (job.opts.delay ?? 0)
      const r = await scanDigests(Number.isFinite(slotMs) ? new Date(slotMs) : new Date())
      console.log(`[scheduled] digest_scan: ${r.emails} digest emails across ${r.tenants} tenants`)
      return
    }
    case 'scheduled_flow_scan': {
      const slotMs = job.timestamp + (job.opts.delay ?? 0)
      const r = await scanScheduledFlows(Number.isFinite(slotMs) ? new Date(slotMs) : new Date())
      if (r.flows > 0 || r.errors > 0)
        console.log(
          `[scheduled] scheduled_flow_scan: ${r.flows} flows fired / ${r.ran} actions / ${r.errors} errors`,
        )
      if (r.errors > 0) {
        throw new Error(`Scheduled flow scan completed with ${r.errors} flow error(s)`)
      }
      return
    }
    case 'report_schedule_scan':
      return scanReportSchedules()
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
    case 'db_maintenance': {
      const result = await runDatabaseMaintenance(job.data.trigger ?? 'scheduled')
      if (!result.ok) {
        throw new Error('Database maintenance completed with one or more table failures')
      }
      return
    }
    case 'domain_event_outbox_scan': {
      const result = await drainDomainEventOutbox()
      if (result.claimed > 0) {
        console.log(
          `[scheduled] domain_event_outbox: ${result.published} published / ${result.retried} retrying`,
        )
      }
      return
    }
    case 'storage_object_deletion_scan': {
      const result = await drainStorageObjectDeletionOutbox()
      if (result.claimed > 0) {
        console.log(
          `[scheduled] storage_object_deletion: ${result.deleted} deleted / ${result.retried} retrying`,
        )
      }
      const uploads = await reconcileExpiredAttachmentUploads()
      if (uploads.examined > 0) {
        console.log(
          `[scheduled] expired_uploads: ${uploads.recovered} recovered / ${uploads.discarded} discarded / ${uploads.errors} errors`,
        )
      }
      if (uploads.errors > 0) {
        throw new Error(`Expired upload reconciliation had ${uploads.errors} error(s)`)
      }
      return
    }
    case 'office_render_reconcile': {
      const result = await reconcileOfficeRenders()
      if (result.candidates > 0) {
        console.log(
          `[scheduled] office_render_reconcile: ${result.enqueued} enqueued / ${result.errors} errors`,
        )
      }
      if (result.errors > 0) {
        throw new Error(`Office render reconciliation had ${result.errors} enqueue error(s)`)
      }
      return
    }
  }
}

// Generic monitored-session overdue scan — the Builder-app successor to
// scanLoneWorkerOverdue. A monitored response is overdue once now passes
// nextCheckinDueAt + grace; we flip it to 'escalated', log a 'missed' check-in,
// and fire the generic escalation. See docs/monitored-sessions-design.md.
const SESSION_SCAN_BATCH = 100
const MAX_SESSIONS_PER_TICK = 500

async function scanFormSessionOverdue(): Promise<void> {
  let processed = 0
  let cursor: { nextCheckinDueAt: Date; id: string } | null = null
  while (processed < MAX_SESSIONS_PER_TICK) {
    const page = await withSuperAdmin(db, async (tx) => {
      const now = new Date()
      // Compare against the DB clock (now()) — avoids worker/DB clock skew and
      // keyset-page the bounded candidates so locked parent assessments cannot
      // starve later sessions. Each candidate is serialized by the shared
      // parent-first response lock before its conditional claim.
      const overdue = await tx
        .select({
          id: formResponses.id,
          tenantId: formResponses.tenantId,
          nextCheckinDueAt: formResponses.nextCheckinDueAt,
        })
        .from(formResponses)
        .where(
          and(
            eq(formResponses.monitorStatus, 'active'),
            sql`${formResponses.nextCheckinDueAt} + ((coalesce(${formResponses.gracePeriodMinutes}, 0))::text || ' minutes')::interval <= now()`,
            cursor
              ? or(
                  gt(formResponses.nextCheckinDueAt, cursor.nextCheckinDueAt),
                  and(
                    eq(formResponses.nextCheckinDueAt, cursor.nextCheckinDueAt),
                    gt(formResponses.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(asc(formResponses.nextCheckinDueAt), asc(formResponses.id))
        .limit(Math.min(SESSION_SCAN_BATCH, MAX_SESSIONS_PER_TICK - processed))
      for (const s of overdue) {
        let mutable: typeof formResponses.$inferSelect | null
        try {
          mutable = await lockFormResponseForMutation(tx, s.tenantId, s.id)
        } catch (error) {
          if (isFormResponseParentLockedError(error)) continue
          throw error
        }
        if (!mutable) continue
        const [claimed] = await tx
          .update(formResponses)
          .set({ monitorStatus: 'escalated', escalatedAt: now })
          .where(
            and(
              eq(formResponses.id, s.id),
              eq(formResponses.tenantId, s.tenantId),
              eq(formResponses.monitorStatus, 'active'),
              sql`${formResponses.nextCheckinDueAt} + ((coalesce(${formResponses.gracePeriodMinutes}, 0))::text || ' minutes')::interval <= now()`,
            ),
          )
          .returning({ id: formResponses.id })
        if (!claimed) continue
        await tx.insert(formResponseCheckins).values({
          tenantId: s.tenantId,
          responseId: s.id,
          kind: 'missed',
          recordedAt: now,
        })
        let submitterEmail: string | null = null
        if (mutable.submittedBy) {
          const [u] = await tx
            .select({ email: users.email })
            .from(tenantUsers)
            .innerJoin(users, eq(users.id, tenantUsers.userId))
            .where(
              and(eq(tenantUsers.id, mutable.submittedBy), eq(tenantUsers.tenantId, s.tenantId)),
            )
            .limit(1)
          submitterEmail = u?.email ?? null
        }
        // Alerting is the monitored app's own session_overdue Flow — a Builder
        // app is per-tenant + dynamic, so the worker does not invent a second
        // fallback audience.
        await runSessionOverdueFlows({
          tx,
          tenantId: s.tenantId,
          responseId: s.id,
          templateId: mutable.templateId,
          data: (mutable.data ?? {}) as Record<string, unknown>,
          submitterEmail,
        })
      }
      const last = overdue.at(-1)
      if (last && !last.nextCheckinDueAt) {
        throw new Error('Overdue monitored response is missing its next check-in timestamp')
      }
      return {
        batchSize: overdue.length,
        nextCursor: last ? { nextCheckinDueAt: last.nextCheckinDueAt!, id: last.id } : null,
      }
    })
    processed += page.batchSize
    cursor = page.nextCursor
    if (page.batchSize < SESSION_SCAN_BATCH || !cursor) break
  }
}

// Cert expiry, document review, and corrective-action overdue are NOT scanned
// here — the compliance obligation engine is the single detector for recurring
// due/overdue/expiry conditions (see compliance-scanner.ts). Monitored-session
// overdue stays: it's a distinct real-time check-in concern, not a duplicate.
