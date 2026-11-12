import 'server-only'

// The incident lifecycle events every creation path shares. A report is either
// STARTED as a draft (the reporter fills it in on the record page, then taps
// Submit report) or CREATED complete in one step (assistant, form spawn, public
// API). Both announce the incident; only a complete report fires the `on_submit`
// Flows trigger, so a flow that emails the incident PDF never ships an empty one.

import { randomUUID } from 'node:crypto'
import type { Database } from '@beaconhs/db'
import type { incidents } from '@beaconhs/db/schema'
import { moduleFlowCommand, recordDomainEvent, recordModuleFlowEvent } from '@beaconhs/events'
import { incidentCreatedEvent } from '@beaconhs/integrations'

type FlowActor = Parameters<typeof recordModuleFlowEvent>[1]

type CreatedIncident = Pick<
  typeof incidents.$inferSelect,
  | 'id'
  | 'reference'
  | 'type'
  | 'severity'
  | 'status'
  | 'title'
  | 'description'
  | 'occurredAt'
  | 'location'
  | 'isDraft'
>

/** Notify, publish to integrations, and run `on_create` (plus `on_submit` when complete). */
export async function recordIncidentCreated(
  tx: Database,
  ctx: FlowActor,
  incident: CreatedIncident,
): Promise<void> {
  await recordDomainEvent(tx, {
    tenantId: ctx.tenantId,
    eventType: 'incident.created',
    subjectId: incident.id,
    dedupKey: `incident.created:${incident.id}`,
    payload: {
      notification: { kind: 'incident_reported', incidentId: incident.id },
      integration: incidentCreatedEvent(ctx.tenantId, incident),
      web: moduleFlowCommand(ctx, {
        subjectId: incident.id,
        moduleKey: 'incidents',
        event: 'on_create',
      }),
    },
  })
  if (!incident.isDraft) await recordIncidentSubmitted(tx, ctx, incident.id)
}

/** Run the incident `on_submit` Flows for a report that is now complete. */
export async function recordIncidentSubmitted(
  tx: Database,
  ctx: FlowActor,
  incidentId: string,
): Promise<void> {
  await recordModuleFlowEvent(tx, ctx, {
    subjectId: incidentId,
    moduleKey: 'incidents',
    event: 'on_submit',
    occurrenceKey: randomUUID(),
  })
}
