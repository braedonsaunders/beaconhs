import {
  bigint,
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { PhotoAnnotation } from '@beaconhs/forms-core'
import { id, timestamps } from './_helpers'
import { tenants, users } from './core'

export const attachmentKind = pgEnum('attachment_kind', [
  'image',
  'document',
  'video',
  'audio',
  'signature',
  'other',
])

export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    uploadedBy: text('uploaded_by').references(() => users.id),
    kind: attachmentKind('kind').notNull(),
    r2Key: text('r2_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    filename: text('filename').notNull(),
    width: bigint('width', { mode: 'number' }),
    height: bigint('height', { mode: 'number' }),
    durationMs: bigint('duration_ms', { mode: 'number' }), // for video/audio
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    geoLat: doublePrecision('geo_lat'),
    geoLng: doublePrecision('geo_lng'),
    exif: jsonb('exif').$type<Record<string, unknown> | null>(),
    // Optional annotation layer (JSON shapes drawn over an image)
    annotations: jsonb('annotations').$type<Annotation[] | null>(),
    caption: text('caption'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('attachments_tenant_idx').on(t.tenantId),
    kindIdx: index('attachments_kind_idx').on(t.tenantId, t.kind),
    tenantIdUx: uniqueIndex('attachments_tenant_id_id_ux').on(t.tenantId, t.id),
    r2KeyUx: uniqueIndex('attachments_r2_key_ux').on(t.r2Key),
  }),
)

/**
 * Server-issued upload reservations. Browser uploads always land on a staging
 * key; finalization verifies this row and the object's immutable metadata,
 * promotes the bytes to r2Key, and consumes the reservation in one DB tx.
 */
export const attachmentUploadReservations = pgTable(
  'attachment_upload_reservations',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: attachmentKind('kind').notNull(),
    stagingKey: text('staging_key').notNull(),
    r2Key: text('r2_key').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    verificationTokenHash: text('verification_token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    attachmentId: uuid('attachment_id'),
    ...timestamps,
  },
  (t) => ({
    tenantExpiryIdx: index('attachment_upload_reservations_tenant_expiry_idx').on(
      t.tenantId,
      t.expiresAt,
    ),
    requestedByIdx: index('attachment_upload_reservations_requested_by_idx').on(
      t.tenantId,
      t.requestedBy,
    ),
    stagingKeyUx: uniqueIndex('attachment_upload_reservations_staging_key_ux').on(t.stagingKey),
    r2KeyUx: uniqueIndex('attachment_upload_reservations_r2_key_ux').on(t.r2Key),
    attachmentUx: uniqueIndex('attachment_upload_reservations_attachment_ux').on(t.attachmentId),
  }),
)

export type Annotation = PhotoAnnotation
