// Brief scheduler — every minute, claim due brief schedules, record one run per
// occurrence (one per recipient department for split schedules), roll each
// schedule forward, and publish queued runs to the `ai` queue.
//
// The run row is the durable source of truth: it is written before Redis
// publication, and any run still `queued` a couple of minutes later is
// re-published with the same deterministic job id.

import { and, asc, desc, eq, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm'
import { db, withSuperAdmin, type Database } from '@beaconhs/db'
import {
  briefRuns,
  briefs,
  briefSchedules,
  departments,
  type BriefRunDelivery,
} from '@beaconhs/db/schema'
import { enqueueAiJob } from '@beaconhs/jobs'
import {
  nextBriefRunAt,
  resolveBriefRecipients,
  resolveBriefWindow,
  type BriefRecipient,
} from '@beaconhs/briefs'

const REPUBLISH_AFTER_MS = 2 * 60_000

type ClaimedRun = { id: string; tenantId: string }

function occurrenceMinute(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000)
}

/** Split recipients by their People department; recipients without one are dropped. */
function byDepartment(recipients: BriefRecipient[]): Map<string, BriefRecipient[]> {
  const groups = new Map<string, BriefRecipient[]>()
  for (const recipient of recipients) {
    if (!recipient.departmentId) continue
    const list = groups.get(recipient.departmentId) ?? []
    list.push(recipient)
    groups.set(recipient.departmentId, list)
  }
  return groups
}

function deliveryFor(recipients: BriefRecipient[], subject: string | null): BriefRunDelivery {
  return {
    userIds: recipients.flatMap((r) => (r.userId ? [r.userId] : [])),
    groupIds: [],
    emails: recipients.flatMap((r) => (r.userId ? [] : [r.email])),
    subject,
  }
}

async function claimDueSchedules(tx: Database, now: Date): Promise<ClaimedRun[]> {
  const due = await tx
    .select({ schedule: briefSchedules, brief: briefs })
    .from(briefSchedules)
    .innerJoin(
      briefs,
      and(eq(briefs.tenantId, briefSchedules.tenantId), eq(briefs.id, briefSchedules.briefId)),
    )
    .where(and(eq(briefSchedules.active, true), lte(briefSchedules.nextRunAt, now)))
    .orderBy(asc(briefSchedules.nextRunAt), asc(briefSchedules.id))
    .limit(50)
    .for('update', { of: briefSchedules, skipLocked: true })

  const claimed: ClaimedRun[] = []
  for (const { schedule, brief } of due) {
    const occurrence = schedule.nextRunAt ?? occurrenceMinute(now)
    const cadence = {
      cadence: schedule.cadence,
      repeatEvery: schedule.repeatEvery,
      dayOfWeek: schedule.dayOfWeek,
      dayOfMonth: schedule.dayOfMonth,
      weekOfMonth: schedule.weekOfMonth,
      hour: schedule.hour,
      minute: schedule.minute,
      timezone: schedule.timezone,
      startsOn: schedule.startsOn,
      endsOn: schedule.endsOn,
      weekdaysOnly: schedule.weekdaysOnly,
    }
    // A worker outage never replays a backlog: the next occurrence is computed
    // from now, so at most one catch-up run is written per schedule.
    const next = nextBriefRunAt(cadence, now)
    await tx
      .update(briefSchedules)
      .set({ nextRunAt: next, ...(next ? {} : { active: false }), updatedAt: now })
      .where(eq(briefSchedules.id, schedule.id))
    if (brief.status !== 'active') continue

    // Same transaction as the schedule lock: run rows reference the locked
    // schedule, so a second connection would block on that lock. Every read
    // below names its tenant explicitly because this connection bypasses RLS.
    const runs = await (async () => {
      const [previous] = await tx
        .select({ windowEnd: briefRuns.windowEnd })
        .from(briefRuns)
        .where(
          and(
            eq(briefRuns.tenantId, schedule.tenantId),
            eq(briefRuns.scheduleId, schedule.id),
            eq(briefRuns.status, 'succeeded'),
            isNotNull(briefRuns.scheduledFor),
          ),
        )
        .orderBy(desc(briefRuns.windowEnd))
        .limit(1)
      const window = resolveBriefWindow(
        schedule.window,
        occurrence,
        schedule.timezone,
        previous?.windowEnd ?? null,
      )
      const base = {
        tenantId: schedule.tenantId,
        briefId: brief.id,
        scheduleId: schedule.id,
        scheduledFor: occurrence,
        trigger: 'scheduled' as const,
        status: 'queued' as const,
        briefName: brief.name,
        specVersion: brief.specVersion,
        specSnapshot: brief.spec,
        windowStart: window.start,
        windowEnd: window.end,
        windowLabel: window.label,
        timezone: window.timezone,
        runAsTenantUserId: schedule.runAsTenantUserId,
        runAsRoleId: schedule.runAsRoleId,
      }
      const delivery: BriefRunDelivery = {
        userIds: schedule.recipientUserIds,
        groupIds: schedule.recipientGroupIds,
        emails: schedule.recipientEmails,
        subject: schedule.emailSubject,
      }
      const values =
        schedule.split === 'department'
          ? [...byDepartment(await resolveBriefRecipients(tx, schedule.tenantId, delivery))].map(
              ([departmentId, recipients]) => ({
                ...base,
                occurrenceKey: `${occurrence.toISOString()}|${departmentId}`,
                departmentId,
                delivery: deliveryFor(recipients, schedule.emailSubject),
              }),
            )
          : [{ ...base, occurrenceKey: occurrence.toISOString(), departmentId: null, delivery }]
      if (values.length === 0) return []
      const departmentIds = values.flatMap((v) => (v.departmentId ? [v.departmentId] : []))
      const known = departmentIds.length
        ? new Set(
            (
              await tx
                .select({ id: departments.id })
                .from(departments)
                .where(
                  and(
                    eq(departments.tenantId, schedule.tenantId),
                    inArray(departments.id, departmentIds),
                  ),
                )
            ).map((d) => d.id),
          )
        : null
      return tx
        .insert(briefRuns)
        .values(values.filter((v) => !v.departmentId || known?.has(v.departmentId)))
        .onConflictDoNothing({
          target: [briefRuns.scheduleId, briefRuns.occurrenceKey],
          where: sql`${briefRuns.scheduleId} is not null`,
        })
        .returning({ id: briefRuns.id, tenantId: briefRuns.tenantId })
    })()
    claimed.push(...runs)
  }
  return claimed
}

export async function scanBriefSchedules(now: Date = new Date()): Promise<{
  claimed: number
  published: number
}> {
  const claimed = await withSuperAdmin(db, (tx) => claimDueSchedules(tx, now))
  const stale = await withSuperAdmin(db, (tx) =>
    tx
      .select({ id: briefRuns.id, tenantId: briefRuns.tenantId })
      .from(briefRuns)
      .where(
        and(
          eq(briefRuns.status, 'queued'),
          lt(briefRuns.updatedAt, new Date(now.getTime() - REPUBLISH_AFTER_MS)),
        ),
      )
      .orderBy(asc(briefRuns.createdAt))
      .limit(100),
  )
  const toPublish = new Map<string, ClaimedRun>()
  for (const run of [...claimed, ...stale]) toPublish.set(run.id, run)
  let published = 0
  for (const run of toPublish.values()) {
    try {
      await enqueueAiJob({ kind: 'brief_run', tenantId: run.tenantId, runId: run.id })
      published++
    } catch (error) {
      console.error(
        `[briefs] could not publish run ${run.id}:`,
        error instanceof Error ? error.message : error,
      )
    }
  }
  if (stale.length > 0) {
    // Touch republished runs so the next scan waits again before retrying.
    await withSuperAdmin(db, (tx) =>
      tx
        .update(briefRuns)
        .set({ updatedAt: now })
        .where(
          and(
            eq(briefRuns.status, 'queued'),
            inArray(
              briefRuns.id,
              stale.map((r) => r.id),
            ),
          ),
        ),
    )
  }
  return { claimed: claimed.length, published }
}
