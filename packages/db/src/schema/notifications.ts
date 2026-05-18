// Notification system. In-app inbox + push + email + SMS channels.
// Each notification type is registered in code; preferences live per (user, tenant, category, channel).

import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants, users } from './core'

export const notificationChannel = pgEnum('notification_channel', ['in_app', 'email', 'push', 'sms'])

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull(), // 'incident' | 'training' | 'ca' | …
    type: text('type').notNull(), // specific type slug, e.g. 'incident.created'
    title: text('title').notNull(),
    body: text('body'),
    linkPath: text('link_path'), // in-app deep link
    data: jsonb('data').$type<Record<string, unknown>>().default({}).notNull(),
    isCritical: boolean('is_critical').default(false).notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('notifications_user_idx').on(t.tenantId, t.userId, t.occurredAt),
    tenantIdx: index('notifications_tenant_idx').on(t.tenantId, t.occurredAt),
    unreadIdx: index('notifications_unread_idx').on(t.tenantId, t.userId, t.readAt),
  }),
)

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    channel: notificationChannel('channel').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    ...timestamps,
  },
  (t) => ({
    uniq: uniqueIndex('notification_preferences_uniq').on(t.tenantId, t.userId, t.category, t.channel),
  }),
)

export const webpushSubscriptions = pgTable(
  'webpush_subscriptions',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    ...timestamps,
  },
  (t) => ({
    userIdx: index('webpush_subscriptions_user_idx').on(t.tenantId, t.userId),
    endpointUx: uniqueIndex('webpush_subscriptions_endpoint_ux').on(t.endpoint),
  }),
)
