// One-time requirements due a number of days after each person's own event —
// "WHMIS within 30 days of hire", "site orientation within 7 days of joining
// the crew". The obligation has one rule; every person gets their own due date.
//
// Event dates come from records BeaconHS already keeps:
//   hire           people.hire_date (unknown → still required, no due date yet)
//   audience_join  compliance_audience_joins, kept by the materializer: the
//                  scan that first finds the person in the audience records
//                  them; leaving drops the row, so re-joining restarts the clock
//   job_title      when the chosen title was assigned to the person
//   group_join     when the person was added to the chosen people group
// Without the title or group membership, the person is not subject at all.

import { and, eq, inArray, notInArray } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  complianceAudienceJoins,
  people,
  personGroupMemberships,
  personTitleAssignments,
  type ComplianceAfterEvent,
} from '@beaconhs/db/schema'
import {
  complianceDate,
  complianceDayStartAt,
  shiftCompletionDate,
  type ComplianceClock,
} from './schedule'

/** personId → event date (YYYY-MM-DD), or null when the event date is not recorded. */
export type AfterEventDates = Map<string, string | null>

/** Validate an after-event rule before it is saved or evaluated. */
export function validateAfterEvent(afterEvent: ComplianceAfterEvent): void {
  if (!Number.isSafeInteger(afterEvent.days) || afterEvent.days < 0 || afterEvent.days > 3650)
    throw new Error('Days after the event must be a whole number from 0 to 3650')
  if (afterEvent.event === 'job_title' && !afterEvent.titleId)
    throw new Error('Pick the job title that starts the clock')
  if (afterEvent.event === 'group_join' && !afterEvent.groupId)
    throw new Error('Pick the people group that starts the clock')
  if (typeof afterEvent.countPrior !== 'boolean')
    throw new Error('Choose whether completions from before the event count')
}

/**
 * Each audience member's event date. People missing from the result are not
 * subject to the requirement (they do not hold the title / group membership).
 */
export async function loadAfterEventDates(
  tx: Database,
  tenantId: string,
  obligationId: string,
  afterEvent: ComplianceAfterEvent,
  personIds: string[],
  clock: ComplianceClock,
): Promise<AfterEventDates> {
  const dates: AfterEventDates = new Map()
  if (personIds.length === 0) return dates
  const day = (value: Date) => complianceDate({ now: value, timezone: clock.timezone })

  if (afterEvent.event === 'hire') {
    const rows = await tx
      .select({ id: people.id, hireDate: people.hireDate })
      .from(people)
      .where(and(eq(people.tenantId, tenantId), inArray(people.id, personIds)))
    for (const row of rows) dates.set(row.id, row.hireDate)
    return dates
  }

  if (afterEvent.event === 'audience_join') {
    const rows = await tx
      .select({
        personId: complianceAudienceJoins.personId,
        joinedAt: complianceAudienceJoins.joinedAt,
      })
      .from(complianceAudienceJoins)
      .where(
        and(
          eq(complianceAudienceJoins.tenantId, tenantId),
          eq(complianceAudienceJoins.obligationId, obligationId),
          inArray(complianceAudienceJoins.personId, personIds),
        ),
      )
    // A member the materializer has not recorded yet (a preview between scans)
    // joins today.
    const today = complianceDate(clock)
    for (const id of personIds) dates.set(id, today)
    for (const row of rows) dates.set(row.personId, day(row.joinedAt))
    return dates
  }

  if (afterEvent.event === 'job_title') {
    if (!afterEvent.titleId) return dates
    const rows = await tx
      .select({
        personId: personTitleAssignments.personId,
        assignedAt: personTitleAssignments.createdAt,
      })
      .from(personTitleAssignments)
      .where(
        and(
          eq(personTitleAssignments.tenantId, tenantId),
          eq(personTitleAssignments.titleId, afterEvent.titleId),
          inArray(personTitleAssignments.personId, personIds),
        ),
      )
    for (const row of rows) dates.set(row.personId, day(row.assignedAt))
    return dates
  }

  if (!afterEvent.groupId) return dates
  const rows = await tx
    .select({
      personId: personGroupMemberships.personId,
      joinedAt: personGroupMemberships.createdAt,
    })
    .from(personGroupMemberships)
    .where(
      and(
        eq(personGroupMemberships.tenantId, tenantId),
        eq(personGroupMemberships.groupId, afterEvent.groupId),
        inArray(personGroupMemberships.personId, personIds),
      ),
    )
  for (const row of rows) dates.set(row.personId, day(row.joinedAt))
  return dates
}

/** The person's due date: the event date plus the rule's days. Null while the event date is unknown. */
export function afterEventDueOn(afterEvent: ComplianceAfterEvent, eventOn: string | null) {
  return eventOn ? shiftCompletionDate(eventOn, 'day', afterEvent.days) : null
}

/** Whether a completion on `completedOn` satisfies the rule for this person. */
export function afterEventEvidenceCounts(
  afterEvent: ComplianceAfterEvent,
  eventOn: string | null,
  completedOn: string,
): boolean {
  return afterEvent.countPrior || !eventOn || completedOn >= eventOn
}

/**
 * When the obligation next needs a scan: the start of the day after the
 * earliest open due date, when that person turns overdue.
 */
export function afterEventNextDueAt(
  rows: ReadonlyArray<{ status: string; dueOn: string | null }>,
  clock: ComplianceClock,
): Date | null {
  const today = complianceDate(clock)
  let earliest: string | null = null
  for (const row of rows) {
    if (row.status === 'completed' || !row.dueOn || row.dueOn < today) continue
    if (!earliest || row.dueOn < earliest) earliest = row.dueOn
  }
  return earliest
    ? complianceDayStartAt(shiftCompletionDate(earliest, 'day', 1), clock.timezone)
    : null
}

/**
 * Keep an obligation's audience join dates current: record people who just
 * entered the audience and forget people who left it. Obligations that do not
 * count from joining keep no rows.
 */
export async function syncComplianceAudienceJoins(
  tx: Database,
  tenantId: string,
  obligation: { id: string; recurrence: { kind: string; afterEvent?: ComplianceAfterEvent } },
  memberIds: string[],
  now: Date,
): Promise<void> {
  const tracksJoins =
    obligation.recurrence.kind === 'one_time' &&
    obligation.recurrence.afterEvent?.event === 'audience_join'
  const keep = tracksJoins ? [...new Set(memberIds)] : []
  await tx
    .delete(complianceAudienceJoins)
    .where(
      and(
        eq(complianceAudienceJoins.tenantId, tenantId),
        eq(complianceAudienceJoins.obligationId, obligation.id),
        keep.length > 0 ? notInArray(complianceAudienceJoins.personId, keep) : undefined,
      ),
    )
  const CHUNK = 500
  for (let index = 0; index < keep.length; index += CHUNK) {
    await tx
      .insert(complianceAudienceJoins)
      .values(
        keep.slice(index, index + CHUNK).map((personId) => ({
          tenantId,
          obligationId: obligation.id,
          personId,
          joinedAt: now,
        })),
      )
      .onConflictDoNothing({
        target: [
          complianceAudienceJoins.tenantId,
          complianceAudienceJoins.obligationId,
          complianceAudienceJoins.personId,
        ],
      })
  }
}
