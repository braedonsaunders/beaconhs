import { integer, timestamp, uuid } from 'drizzle-orm/pg-core'

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

/**
 * Lease and retry cursor shared by durable publisher ledgers.
 *
 * A queued row is eligible only when `publishAvailableAt` has arrived and no
 * live lease owns it. Publishers increment attempts when claiming, then either
 * clear the lease on success or move availability forward with backoff.
 */
export const durablePublication = {
  publishAttempts: integer('publish_attempts').default(0).notNull(),
  publishAvailableAt: timestamp('publish_available_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  publishLeaseId: uuid('publish_lease_id'),
  publishClaimedAt: timestamp('publish_claimed_at', { withTimezone: true }),
}

export const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}
