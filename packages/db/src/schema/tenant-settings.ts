// Tenant-level notification overrides.
// If rows exist for (tenantId, category), the domain event dispatcher uses those
// recipients in addition to / instead of the default role-based audience.

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants, users } from './core'

export const tenantNotificationRecipients = pgTable(
  'tenant_notification_recipients',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    category: text('category').notNull(), // e.g. 'incident' | 'ca' | 'training' | 'document'
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('tenant_notification_recipients_tenant_idx').on(t.tenantId, t.category),
    uniq: uniqueIndex('tenant_notification_recipients_uniq').on(t.tenantId, t.category, t.userId),
  }),
)

// Tenant-wide notification POLICY (one row per tenant) — the routing defaults
// that aren't per-category. Drives the unified detection switchover (Phase 1),
// digest batching + quiet hours (Phase 2). A missing row = built-in defaults.
export const tenantNotificationPolicy = pgTable(
  'tenant_notification_policy',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Batch non-critical alerts into a periodic digest instead of sending each
    // immediately. 'off' = immediate (today's behaviour).
    digestMode: text('digest_mode').default('off').notNull(), // 'off' | 'daily' | 'weekly'
    digestHourUtc: integer('digest_hour_utc').default(7).notNull(),
    // Suppress non-critical sends during these UTC hours (e.g. 22→6 overnight).
    // null = no quiet hours. Critical alerts always go through.
    quietHours: jsonb('quiet_hours').$type<{ start: number; end: number } | null>().default(null),
    ...timestamps,
  },
  (t) => ({
    uniq: uniqueIndex('tenant_notification_policy_uniq').on(t.tenantId),
  }),
)

// Per-(tenant, category) configuration for the automatic notification system,
// surfaced in /admin/notifications. Drives both the event audience resolver
// (enabled + roleKeys + userIds) and the worker reminder scans (reminderHours).
// A missing row means "use the built-in defaults" — the table is purely an
// override layer, so existing tenants behave exactly as before until edited.
export const tenantNotificationSettings = pgTable(
  'tenant_notification_settings',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    // Master switch for this category's automatic alerts (in-app + email).
    enabled: boolean('enabled').default(true).notNull(),
    // Role keys whose active members receive the alert. Empty => category default.
    roleKeys: jsonb('role_keys').$type<string[]>().default([]).notNull(),
    // Specific extra recipients (Better-Auth user ids), merged on top of roles.
    userIds: jsonb('user_ids').$type<string[]>().default([]).notNull(),
    // Routing (Phase 2): which channels this category may use. The notify worker
    // intersects this with each user's per-channel preferences. Empty => the
    // emitter's built-in channel set.
    channels: jsonb('channels').$type<string[]>().default([]).notNull(),
    // Escalation ladder (Phase 2): once a subject has been overdue for N days,
    // also alert these roles. Evaluated daily against compliance_status.
    escalation: jsonb('escalation')
      .$type<{ afterDays: number; roleKeys: string[] }[]>()
      .default([])
      .notNull(),
    ...timestamps,
  },
  (t) => ({
    uniq: uniqueIndex('tenant_notification_settings_uniq').on(t.tenantId, t.category),
  }),
)
