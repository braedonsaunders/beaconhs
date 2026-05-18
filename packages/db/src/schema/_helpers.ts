import { sql } from 'drizzle-orm'
import { timestamp, uuid } from 'drizzle-orm/pg-core'

// Conventions used across every table.
// - ids: uuid v7-ish via gen_random_uuid()
// - timestamps: created_at, updated_at, both with tz, not null, default now()
// - soft delete: deleted_at, nullable

export const id = () => uuid('id').primaryKey().defaultRandom()

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
}

export const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}

export const tenantFk = (refTenants: () => { id: any }) =>
  uuid('tenant_id')
    .notNull()
    .references(() => refTenants().id, { onDelete: 'cascade' })

export const json = <T>() => sql<T>`jsonb`
