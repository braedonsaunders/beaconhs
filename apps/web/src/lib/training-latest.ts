// "Latest record per person × course" — the platform-wide rule for training
// expiry. People are retrained: a person routinely has several records for the
// same course, and only the most recent one is their current standing. Older
// records are superseded history and must never surface as expired/expiring
// compliance work (they'd show a person as "expired" who was retrained years
// ago). The same semantics live in the `report_training_matrix` view
// (packages/db/src/views.ts) and the people-profile transcript dedup — keep
// all three in sync.

import { sql, type SQL } from 'drizzle-orm'
import { trainingRecords } from '@beaconhs/db/schema'

/**
 * Predicate for queries FROM `training_records`: true when the row is the
 * person's most recent non-deleted record for its course (newest
 * `completed_on`, ties broken by `created_at` then `id`, matching the
 * `report_training_matrix` view). Records without a course can't be
 * superseded, so they always pass. Compose it into `and(...)` wherever a
 * record's expiry is treated as a live signal — counts, "expiring soon"
 * lists, wallet cards — as opposed to history/transcript views.
 */
export function latestTrainingRecordOnly(): SQL<unknown> {
  return sql`(
    ${trainingRecords.courseId} is null
    or not exists (
      select 1
      from training_records tr_newer
      where tr_newer.tenant_id = ${trainingRecords.tenantId}
        and tr_newer.person_id = ${trainingRecords.personId}
        and tr_newer.course_id = ${trainingRecords.courseId}
        and tr_newer.deleted_at is null
        and (tr_newer.completed_on, tr_newer.created_at, tr_newer.id)
          > (${trainingRecords.completedOn}, ${trainingRecords.createdAt}, ${trainingRecords.id})
    )
  )`
}
