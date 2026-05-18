// Public REST API keys, per tenant.

import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants, users } from './core'

export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Hash of the secret; the secret itself is only shown once at creation.
    keyHash: text('key_hash').notNull(),
    prefix: text('prefix').notNull(), // e.g. 'bhs_live_…' first 8 chars, shown in UI
    scopes: jsonb('scopes').$type<string[]>().default([]).notNull(),
    createdBy: text('created_by').references(() => users.id),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('api_keys_tenant_idx').on(t.tenantId),
    hashIdx: index('api_keys_hash_idx').on(t.keyHash),
  }),
)
