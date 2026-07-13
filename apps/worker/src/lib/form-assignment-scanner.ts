// Scheduled form-assignment scanner.
//
// Walks every active form_assignments row where mode='scheduled' and a cron
// expression is present. For each, computes "is the cron due now" relative to
// the latest dispatch (or the assignment's createdAt if no dispatches yet).
// Each due assignment is first claimed in form_assignment_dispatches with an
// immutable audience/payload snapshot. A separate publication pass sends every
// queued row to BullMQ using its deterministic dispatch id.
//
// Missed occurrences (worker downtime, assignment re-enabled after a gap) are
// FAST-FORWARDED: one dispatch fires at the most recent occurrence <= now
// instead of replaying every missed slot one per tick.
//
// Idempotency: a database unique constraint on (assignmentId, occurredAt)
// closes the multi-replica race. If Redis is unavailable after the claim
// commits, the next scan republishes the still-queued dispatch.

import { and, asc, eq, isNotNull, max } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { formAssignmentDispatches, formAssignments, formTemplates } from '@beaconhs/db/schema'
import { resolveObligationAudience, type AudienceItem } from '@beaconhs/compliance'
import { enqueueNotification } from '@beaconhs/jobs'
import { lastCronOccurrenceBetween, parseCron, type CronFields } from './cron'

type FormAssignmentScanResult = {
  candidates: number
  dispatched: number
  skipped: number
  errors: number
}

export async function scanFormAssignments(
  now: Date = new Date(),
): Promise<FormAssignmentScanResult> {
  const result: FormAssignmentScanResult = {
    candidates: 0,
    dispatched: 0,
    skipped: 0,
    errors: 0,
  }

  // Pull all active scheduled assignments + their last-fire timestamps.
  const rows = await withSuperAdmin(db, async (tx) => {
    return tx
      .select({
        assignment: formAssignments,
        templateName: formTemplates.name,
        lastFiredAt: max(formAssignmentDispatches.occurredAt),
      })
      .from(formAssignments)
      .innerJoin(formTemplates, eq(formTemplates.id, formAssignments.templateId))
      .leftJoin(
        formAssignmentDispatches,
        eq(formAssignmentDispatches.assignmentId, formAssignments.id),
      )
      .where(
        and(
          eq(formAssignments.mode, 'scheduled'),
          eq(formAssignments.enabled, true),
          isNotNull(formAssignments.cron),
        ),
      )
      .groupBy(formAssignments.id, formTemplates.name)
      .orderBy(asc(formAssignments.id))
  })

  for (const row of rows) {
    result.candidates += 1
    const { assignment, templateName, lastFiredAt } = row
    if (!assignment.cron) {
      result.skipped += 1
      continue
    }
    let fields: CronFields
    try {
      fields = parseCron(assignment.cron)
    } catch (err) {
      result.errors += 1
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[form_assignment_scan] bad cron on ${assignment.id}: ${msg}`)
      continue
    }

    // Fast-forward to the most recent occurrence <= now: after downtime a daily
    // assignment fires once, not once per missed day.
    const after = lastFiredAt ?? assignment.createdAt
    const due = lastCronOccurrenceBetween(fields, after, now)
    if (!due) {
      result.skipped += 1
      continue
    }

    try {
      const audience = await resolveAssigneeUserIds(assignment)
      const notificationPayload =
        audience.length > 0
          ? {
              title: `Form due: ${templateName}`,
              body: assignment.dueOffsetMinutes
                ? `Please complete within ${assignment.dueOffsetMinutes} minutes.`
                : undefined,
              linkPath: `/apps/templates/${assignment.templateId}/fill?assignment=${assignment.id}`,
              data: { assignmentId: assignment.id, templateId: assignment.templateId },
            }
          : null
      const [claimed] = await withSuperAdmin(db, (tx) =>
        tx
          .insert(formAssignmentDispatches)
          .values({
            tenantId: assignment.tenantId,
            assignmentId: assignment.id,
            occurredAt: due,
            status: audience.length > 0 ? 'queued' : 'skipped',
            audienceUserIds: audience,
            notificationPayload,
            error: audience.length === 0 ? 'no audience' : null,
          })
          .onConflictDoNothing({
            target: [formAssignmentDispatches.assignmentId, formAssignmentDispatches.occurredAt],
          })
          .returning({ id: formAssignmentDispatches.id }),
      )
      if (!claimed || audience.length === 0) {
        result.skipped += 1
      }
    } catch (err) {
      result.errors += 1
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[form_assignment_scan] dispatch ${assignment.id} failed: ${msg}`)
    }
  }

  // Publish every durable queued claim, including rows left behind by an
  // earlier Redis outage. The deterministic job id makes a crash between
  // Queue.add and the status update safe.
  const queued = await withSuperAdmin(db, (tx) =>
    tx
      .select()
      .from(formAssignmentDispatches)
      .where(eq(formAssignmentDispatches.status, 'queued'))
      .orderBy(asc(formAssignmentDispatches.createdAt))
      .limit(500),
  )
  for (const dispatch of queued) {
    if (!dispatch.notificationPayload || dispatch.audienceUserIds.length === 0) {
      result.errors += 1
      await withSuperAdmin(db, (tx) =>
        tx
          .update(formAssignmentDispatches)
          .set({
            status: 'failed',
            error: 'Queued dispatch has no notification payload or audience',
          })
          .where(eq(formAssignmentDispatches.id, dispatch.id)),
      )
      continue
    }
    const notificationJobId = `form-assignment|${dispatch.id}`
    try {
      await enqueueNotification(
        {
          tenantId: dispatch.tenantId,
          userIds: dispatch.audienceUserIds,
          category: 'forms',
          type: 'form_assignment.due',
          ...dispatch.notificationPayload,
        },
        { jobId: notificationJobId },
      )
      await withSuperAdmin(db, (tx) =>
        tx
          .update(formAssignmentDispatches)
          .set({ status: 'enqueued', notificationJobId, error: null })
          .where(
            and(
              eq(formAssignmentDispatches.id, dispatch.id),
              eq(formAssignmentDispatches.status, 'queued'),
            ),
          ),
      )
      result.dispatched += 1
    } catch (error) {
      result.errors += 1
      await withSuperAdmin(db, (tx) =>
        tx
          .update(formAssignmentDispatches)
          .set({ error: error instanceof Error ? error.message : String(error) })
          .where(eq(formAssignmentDispatches.id, dispatch.id)),
      )
    }
  }

  if (result.dispatched > 0 || result.errors > 0) {
    console.log(
      `[form_assignment_scan] candidates=${result.candidates} dispatched=${result.dispatched} skipped=${result.skipped} errors=${result.errors}`,
    )
  }
  return result
}

// --- Audience resolver ----------------------------------------------------

async function resolveAssigneeUserIds(
  assignment: typeof formAssignments.$inferSelect,
): Promise<string[]> {
  // Delegates to the ONE canonical resolver (@beaconhs/compliance) — no
  // duplicated audience logic. Maps the form_assignment JSONB target arrays to
  // the unified AudienceItem shape, then collapses to notifiable user ids.
  const items: AudienceItem[] = [
    ...(assignment.targetPersonIds ?? []).map((id) => ({ kind: 'person' as const, entityKey: id })),
    ...(assignment.targetRoleKeys ?? []).map((k) => ({ kind: 'role' as const, entityKey: k })),
    ...(assignment.targetOrgUnitIds ?? []).map((id) => ({
      kind: 'org_unit' as const,
      entityKey: id,
    })),
  ]
  if (items.length === 0) return []
  const members = await withSuperAdmin(db, (tx) =>
    resolveObligationAudience(tx, assignment.tenantId, items),
  )
  return members.map((m) => m.userId).filter((u): u is string => Boolean(u))
}
