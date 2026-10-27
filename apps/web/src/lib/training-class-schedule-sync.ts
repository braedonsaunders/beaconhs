// Publishes the generic `training.class.schedule_changed` desired-state
// snapshot for outbound automations (any HTTP/SQL/… destination a tenant
// configured). Every class mutation calls this inside its transaction; the
// coalescing outbox folds a burst of edits into one delivery carrying the
// latest roster/schedule, a few seconds after the edits settle.

import { randomUUID } from 'node:crypto'
import type { Database } from '@beaconhs/db'
import { recordCoalescibleDomainEvent } from '@beaconhs/events'
import {
  TRAINING_CLASS_SCHEDULE_CHANGED,
  TRAINING_CLASS_SCHEDULE_SYNC_DELAY_MS,
  loadTrainingClassScheduleEvent,
  type TrainingClassScheduleStatus,
} from '@beaconhs/integrations'
import type { IntegrationEvent } from '@beaconhs/integrations'

/** Record one already-built schedule snapshot event (coalesced per class). */
export async function recordTrainingClassScheduleSnapshot(
  tx: Database,
  tenantId: string,
  event: IntegrationEvent | null,
): Promise<void> {
  if (!event) return
  await recordCoalescibleDomainEvent(
    tx,
    {
      tenantId,
      eventType: TRAINING_CLASS_SCHEDULE_CHANGED,
      subjectId: event.subjectId,
      dedupKey: `${TRAINING_CLASS_SCHEDULE_CHANGED}:${event.subjectId}:${randomUUID()}`,
      payload: { integration: event },
    },
    TRAINING_CLASS_SCHEDULE_SYNC_DELAY_MS,
  )
}

/** Load the class's current schedule snapshot in `tx` and record it. */
export async function syncTrainingClassSchedule(
  tx: Database,
  tenantId: string,
  classId: string,
  status: TrainingClassScheduleStatus,
): Promise<void> {
  const event = await loadTrainingClassScheduleEvent(tx, tenantId, classId, status)
  await recordTrainingClassScheduleSnapshot(tx, tenantId, event)
}
