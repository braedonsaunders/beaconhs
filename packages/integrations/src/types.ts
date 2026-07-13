// Outbound automation contract — the generic "trigger → data → service" model.
//
// A built automation (one tenant_integrations row) wires a TRIGGER (a domain
// event) to a DESTINATION (an external service) via a per-destination MAPPING.
// Core modules only ever emit a vendor-neutral event carrying a flat list of
// `Item`s (token namespaces); the destination maps each item to its own shape.
// Nothing tenant/vendor-specific lives in code — it's all configuration.

import type { ConfigField, SecretField } from '@beaconhs/sync'
import type { RequestContext } from '@beaconhs/tenant'

export type Scalar = string | number | boolean | null

// One unit of data to send. A single-record trigger emits one item; a
// collection trigger (e.g. a training class) emits one item per sub-record
// (e.g. per attendee). Keys are the tokens the mapping references as {{key}}.
export type Item = Record<string, Scalar>

// What core emits at a trigger point. `items` are already resolved from the
// entity, so the dispatcher and destinations never re-query the source.
export interface IntegrationEvent {
  type: string // trigger key, e.g. 'incident.created'
  tenantId: string
  subjectId: string // the source entity id — ledger key + idempotency
  items: Item[]
}

// --- Triggers --------------------------------------------------------------

export interface FieldDef {
  key: string // the token, used as {{key}}
  label: string
  type: 'string' | 'number' | 'boolean' | 'date'
  sample?: Scalar // shown in the builder + used for "send a sample"
  note?: string
}

export interface TriggerDef {
  key: string
  label: string
  description: string
  module: string // e.g. 'incidents' — for grouping/icon
  iconKey: string
  subjectLabel: string // singular noun, e.g. 'incident'
  itemScope: 'single' | 'collection'
  fields: FieldDef[]
  // Triggers whose payload carries arbitrary keys (e.g. a form's own fields)
  // advertise the open namespace here for the token reference panel.
  dynamicFieldsNote?: string
}

// --- Destinations ----------------------------------------------------------

export interface IntegrationResult {
  ok: boolean
  summary?: string
  error?: string
}

export interface DeliverRef {
  externalRef: string // id of the external thing we created (for the ledger)
  detail?: Record<string, unknown>
}

export interface DeliverResult extends IntegrationResult {
  refs?: DeliverRef[]
}

// Read-only context for a connectivity test (no items yet).
export interface DestinationTestContext {
  tenantId: string
  db: RequestContext['db']
  config: Record<string, unknown>
  secrets: Record<string, string> // already unsealed
}

// Full context for a delivery. `mapping` is the destination-specific mapping
// object stored under config.mapping. `priorRefs` are the external refs from the
// last delivery for this (automation, subject) — a reversible destination (SQL)
// deletes them before re-posting.
export interface DeliverContext extends DestinationTestContext {
  triggerKey: string
  subjectId: string
  items: Item[]
  mapping: Record<string, unknown>
  priorRefs: string[]
  // Successful refs from an earlier partial attempt. Destinations with
  // multi-request delivery use these to resume without replaying known
  // successes. Completed prior deliveries are excluded so intentional re-fires
  // still work when oncePerRecord is off.
  retryRefs: string[]
  oncePerRecord: boolean
  log: (level: 'info' | 'warn' | 'error', msg: string) => void
}

export interface DestinationDef {
  key: string
  name: string
  description: string
  iconKey: string
  mappingKind: 'sql' | 'http' | 'slack' | 'sheets' | 'email'
  configFields: ConfigField[]
  secretFields: SecretField[]
  // Whether re-firing should, by default, only deliver once per source record
  // (non-reversible destinations like email/slack default this on in the UI).
  reversible: boolean
  test?(ctx: DestinationTestContext): Promise<IntegrationResult>
  deliver(ctx: DeliverContext): Promise<DeliverResult>
}
