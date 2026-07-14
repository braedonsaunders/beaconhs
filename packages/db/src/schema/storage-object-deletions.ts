import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'

export const storageObjectDeletionStatus = pgEnum('storage_object_deletion_status', [
  'pending',
  'deleting',
])

/**
 * Durable intent to remove an object after its attachment row is deleted.
 *
 * The database trigger installed with this table inserts the intent in the
 * same transaction as every attachment-row deletion. Object deletion is
 * idempotent, so a lost lease or a completion-write failure can safely retry.
 * Completed intents are removed with an exact lease compare-and-delete; this
 * table therefore contains only live work and cannot accumulate terminal rows.
 */
export const storageObjectDeletionOutbox = pgTable(
  'storage_object_deletion_outbox',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      // Never cascade committed deletion work away. A hard tenant delete is
      // intentionally blocked until its attachments are explicitly deleted
      // and this outbox has drained.
      .references(() => tenants.id),
    attachmentId: uuid('attachment_id').notNull(),
    objectKey: text('object_key').notNull(),
    status: storageObjectDeletionStatus('status').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    leaseId: uuid('lease_id'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    lastError: text('last_error'),
    ...timestamps,
  },
  (t) => ({
    tenantIdIdUx: uniqueIndex('storage_object_deletion_outbox_tenant_id_id_ux').on(
      t.tenantId,
      t.id,
    ),
    attachmentUx: uniqueIndex('storage_object_deletion_outbox_attachment_ux').on(t.attachmentId),
    objectKeyUx: uniqueIndex('storage_object_deletion_outbox_object_key_ux').on(t.objectKey),
    statusAvailableIdx: index('storage_object_deletion_outbox_status_available_idx').on(
      t.status,
      t.availableAt,
    ),
    statusClaimedIdx: index('storage_object_deletion_outbox_status_claimed_idx').on(
      t.status,
      t.claimedAt,
    ),
    tenantAttachmentIdx: index('storage_object_deletion_outbox_tenant_attachment_idx').on(
      t.tenantId,
      t.attachmentId,
    ),
    tenantKeyCheck: check(
      'storage_object_deletion_outbox_tenant_key_ck',
      sql`${t.objectKey} like ('t/' || ${t.tenantId}::text || '/%')`,
    ),
    attemptsCheck: check('storage_object_deletion_outbox_attempts_ck', sql`${t.attempts} >= 0`),
    leaseStateCheck: check(
      'storage_object_deletion_outbox_lease_state_ck',
      sql`(
        (${t.status} = 'pending' AND ${t.leaseId} IS NULL AND ${t.claimedAt} IS NULL)
        OR
        (${t.status} = 'deleting' AND ${t.leaseId} IS NOT NULL AND ${t.claimedAt} IS NOT NULL)
      )`,
    ),
  }),
)
