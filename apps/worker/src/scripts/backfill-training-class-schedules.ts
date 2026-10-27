// Backfill: re-emit the generic `training.class.schedule_changed` snapshot
// for every future, non-cancelled, not-yet-completed training class of a
// tenant, so outbound automations (e.g. a connected scheduling/booking
// system) receive the desired state for classes that were scheduled before
// the automation existed.
//
//   pnpm --filter @beaconhs/worker exec tsx src/scripts/backfill-training-class-schedules.ts --tenant <uuid> [--apply] [--from YYYY-MM-DD]
//
// Dry-run by default: prints the classes it would emit and changes nothing.
// With --apply each class's snapshot is recorded in the coalescing domain
// outbox (staggered a few seconds apart) and an audit row is written per
// tenant run. Safe to re-run: snapshots are full desired-state replaces and
// coalesce with any pending edit-triggered snapshot for the same class.

import { randomUUID } from 'node:crypto'
import { and, asc, eq, gte, isNull } from 'drizzle-orm'
import { db, withTenant } from '@beaconhs/db'
import { auditLog, trainingClasses } from '@beaconhs/db/schema'
import { recordCoalescibleDomainEvent } from '@beaconhs/events'
import {
  TRAINING_CLASS_SCHEDULE_CHANGED,
  TRAINING_CLASS_SCHEDULE_SYNC_DELAY_MS,
  loadTrainingClassScheduleEvent,
} from '@beaconhs/integrations'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const tenantId = arg('tenant')?.trim()
  if (!tenantId) throw new Error('--tenant <uuid> is required')
  const apply = process.argv.includes('--apply')
  const fromArg = arg('from')?.trim()
  const from = fromArg ? new Date(`${fromArg}T00:00:00.000Z`) : new Date()
  if (Number.isNaN(from.getTime())) throw new Error(`--from "${fromArg}" is not a valid date`)

  const classes = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        id: trainingClasses.id,
        title: trainingClasses.title,
        startsAt: trainingClasses.startsAt,
      })
      .from(trainingClasses)
      .where(
        and(
          gte(trainingClasses.startsAt, from),
          isNull(trainingClasses.cancelledAt),
          isNull(trainingClasses.completedAt),
        ),
      )
      .orderBy(asc(trainingClasses.startsAt), asc(trainingClasses.id)),
  )

  console.log(
    `[backfill-class-schedules] tenant=${tenantId} from=${from.toISOString()} classes=${classes.length} mode=${apply ? 'APPLY' : 'dry-run'}`,
  )
  for (const cls of classes) {
    console.log(`  ${cls.id} ${new Date(cls.startsAt).toISOString()} ${cls.title}`)
  }
  if (!apply) {
    console.log('[backfill-class-schedules] dry-run only; pass --apply to emit.')
    return
  }

  let emitted = 0
  for (const [index, cls] of classes.entries()) {
    const didEmit = await withTenant(db, tenantId, async (tx) => {
      // Re-check under the class lock so a class cancelled/completed since
      // the scan is skipped rather than booked.
      const [row] = await tx
        .select({
          cancelledAt: trainingClasses.cancelledAt,
          completedAt: trainingClasses.completedAt,
        })
        .from(trainingClasses)
        .where(eq(trainingClasses.id, cls.id))
        .limit(1)
        .for('update')
      if (!row || row.cancelledAt || row.completedAt) return false
      const event = await loadTrainingClassScheduleEvent(tx, tenantId, cls.id, 'scheduled')
      if (!event) return false
      await recordCoalescibleDomainEvent(
        tx,
        {
          tenantId,
          eventType: TRAINING_CLASS_SCHEDULE_CHANGED,
          subjectId: cls.id,
          dedupKey: `${TRAINING_CLASS_SCHEDULE_CHANGED}:${cls.id}:${randomUUID()}`,
          payload: { integration: event },
        },
        // Stagger backfill deliveries so a destination is not hit all at once.
        TRAINING_CLASS_SCHEDULE_SYNC_DELAY_MS + index * 1_000,
      )
      return true
    })
    if (didEmit) emitted += 1
  }

  await withTenant(db, tenantId, (tx) =>
    tx.insert(auditLog).values({
      tenantId,
      entityType: 'training_class',
      action: 'export',
      summary: `Backfilled class schedule snapshots for ${emitted} upcoming class(es)`,
      metadata: { emitted, scanned: classes.length, from: from.toISOString() },
    }),
  )
  console.log(`[backfill-class-schedules] emitted ${emitted}/${classes.length} snapshot(s).`)
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(
      '[backfill-class-schedules] FAILED:',
      error instanceof Error ? error.message : error,
    )
    process.exit(1)
  })
