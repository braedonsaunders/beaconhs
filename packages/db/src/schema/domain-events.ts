import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'

export type DomainEventScalar = string | number | boolean | null
export type DomainIntegrationEvent = {
  type: string
  tenantId: string
  subjectId: string
  items: Array<Record<string, DomainEventScalar>>
}

export type DomainNotificationEvent =
  | { kind: 'incident_reported'; incidentId: string }
  | {
      kind: 'incident_status_changed'
      incidentId: string
      fromStatus: string
      toStatus: string
    }
  | {
      kind: 'corrective_action_assigned'
      caId: string
      assigneeUserId?: string | null
      assignerUserId?: string | null
    }
  | { kind: 'corrective_action_completed'; caId: string }

export type DomainEventActor = {
  userId: string
  membershipId: string | null
  personId: string | null
  timezone: string
}

export type DomainWebCommand =
  | {
      kind: 'module_flow'
      subjectId: string
      moduleKey: string
      event:
        | 'on_submit'
        | 'status_change'
        | 'on_create'
        | 'on_sign'
        | 'on_lock'
        | 'on_unlock'
        | 'on_delete'
      toStatus?: string
      actor: DomainEventActor
    }
  | {
      kind: 'form_submitted'
      subjectId: string
      templateId: string
      data: Record<string, unknown>
      score: number
      status: string
      recap: boolean
      actor: DomainEventActor
    }
  | {
      kind: 'flow_gate_decided'
      subjectId: string
      gateId: string
      decision: 'approve' | 'reject'
      actor: DomainEventActor
    }
  | {
      kind: 'form_status_changed'
      subjectId: string
      templateId: string
      data: Record<string, unknown>
      score: number | null
      status: string | null
      toStatus: string
      actor: DomainEventActor
    }

export type DomainEventPayload = {
  notification?: DomainNotificationEvent
  integration?: DomainIntegrationEvent
  web?: DomainWebCommand
}

export const domainEventOutboxStatus = pgEnum('domain_event_outbox_status', [
  'pending',
  'publishing',
  'published',
])

export const domainEventOutbox = pgTable(
  'domain_event_outbox',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    dedupKey: text('dedup_key').notNull(),
    payload: jsonb('payload').$type<DomainEventPayload>().notNull(),
    status: domainEventOutboxStatus('status').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    notificationPublishedAt: timestamp('notification_published_at', { withTimezone: true }),
    integrationPublishedAt: timestamp('integration_published_at', { withTimezone: true }),
    webPublishedAt: timestamp('web_published_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    lastError: text('last_error'),
    ...timestamps,
  },
  (t) => ({
    tenantIdIdUx: uniqueIndex('domain_event_outbox_tenant_id_id_ux').on(t.tenantId, t.id),
    tenantDedupUx: uniqueIndex('domain_event_outbox_tenant_dedup_ux').on(t.tenantId, t.dedupKey),
    statusAvailableIdx: index('domain_event_outbox_status_available_idx').on(
      t.status,
      t.availableAt,
    ),
    statusClaimedIdx: index('domain_event_outbox_status_claimed_idx').on(t.status, t.claimedAt),
    tenantSubjectIdx: index('domain_event_outbox_tenant_subject_idx').on(
      t.tenantId,
      t.subjectId,
      t.createdAt,
    ),
  }),
)

export const domainEventEffects = pgTable(
  'domain_event_effects',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull(),
    effectKey: text('effect_key').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    completedAt: timestamp('completed_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (t) => ({
    eventEffectUx: uniqueIndex('domain_event_effects_event_effect_ux').on(
      t.tenantId,
      t.eventId,
      t.effectKey,
    ),
    eventIdx: index('domain_event_effects_event_idx').on(t.tenantId, t.eventId),
    eventFk: foreignKey({
      name: 'domain_event_effects_tenant_event_fk',
      columns: [t.tenantId, t.eventId],
      foreignColumns: [domainEventOutbox.tenantId, domainEventOutbox.id],
    }).onDelete('cascade'),
  }),
)
