// Tenant-level notification overrides.
// If rows exist for (tenantId, category), the domain event dispatcher uses those
// recipients in addition to / instead of the default role-based audience.

import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
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
