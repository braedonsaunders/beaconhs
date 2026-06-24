// Outbound-integration contract.
//
// Core modules emit a generic, vendor-neutral domain event. A code-registered
// OutboundIntegration (disabled per tenant unless explicitly enabled) maps that
// event to an external system. This keeps everything tenant/vendor-specific out
// of the open-source core — the only thing core does is emit the event.
//
// The shape intentionally mirrors the sync Connector (configFields/secretFields
// declared, secrets sealed) so the admin UI can render its settings form
// generically and reuse sealSecret/unsealSecret.

import type { ConfigField, SecretField } from '@beaconhs/sync'
import type { RequestContext } from '@beaconhs/tenant'

export type IntegrationEventType = 'training.class.completed'

// Emitted when an instructor-led training class is marked complete. Generic by
// design: it carries the facts an external time/HR system needs (who, how many
// hours, when, which course) without encoding any one vendor's contract.
export interface TrainingClassCompletedEvent {
  type: 'training.class.completed'
  tenantId: string
  classId: string
  course: { code: string; name: string }
  startsAt: string // ISO 8601
  endsAt: string // ISO 8601
  // Resolved on the way out: explicit class override, else derived from the
  // schedule. Integrations that bucket hours by day use these two.
  hoursPerDay: number
  lengthDays: number
  attendees: TrainingClassAttendeeFact[]
}

export interface TrainingClassAttendeeFact {
  personId: string
  externalEmployeeId: string | null // people.external_employee_id
  firstName: string
  lastName: string
  departmentName: string | null
  attended: boolean
  hours: number // total credited hours for this attendee (0 if not attended)
}

export type IntegrationEvent = TrainingClassCompletedEvent

// Runtime context handed to an integration. `db` is the tenant-bound executor
// (RLS-scoped) — integrations call it to read source data and write the export
// ledger. External I/O happens between db() calls, never inside one.
export interface OutboundIntegrationContext {
  tenantId: string
  db: RequestContext['db']
  config: Record<string, unknown>
  secrets: Record<string, string> // already unsealed
  log: (level: 'info' | 'warn' | 'error', msg: string) => void
}

export interface IntegrationResult {
  ok: boolean
  summary?: string
  error?: string
}

export interface OutboundIntegration {
  key: string
  name: string
  description: string
  events: IntegrationEventType[]
  configFields: ConfigField[]
  secretFields: SecretField[]
  // Optional connectivity check (e.g. open the connection + SELECT 1).
  test?(ctx: OutboundIntegrationContext): Promise<IntegrationResult>
  handle(ctx: OutboundIntegrationContext, event: IntegrationEvent): Promise<IntegrationResult>
}
