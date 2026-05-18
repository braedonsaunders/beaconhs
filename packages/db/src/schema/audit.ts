import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { id } from './_helpers'
import { tenants, users } from './core'

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorIp: text('actor_ip'),
    actorUserAgent: text('actor_user_agent'),
    entityType: text('entity_type').notNull(), // e.g. 'incident', 'form_response'
    entityId: uuid('entity_id'),
    action: text('action').notNull(), // 'create' | 'update' | 'delete' | 'sign' | …
    summary: text('summary'),
    before: jsonb('before').$type<Record<string, unknown> | null>(),
    after: jsonb('after').$type<Record<string, unknown> | null>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantIdx: index('audit_log_tenant_idx').on(t.tenantId, t.occurredAt),
    entityIdx: index('audit_log_entity_idx').on(t.tenantId, t.entityType, t.entityId),
    actorIdx: index('audit_log_actor_idx').on(t.tenantId, t.actorUserId, t.occurredAt),
  }),
)
