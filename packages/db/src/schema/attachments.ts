import {
  bigint,
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
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
    uploadedBy: uuid('uploaded_by').references(() => users.id),
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
  }),
)

export type Annotation =
  | { type: 'arrow'; from: [number, number]; to: [number, number]; color: string; width: number }
  | { type: 'circle'; cx: number; cy: number; r: number; color: string; width: number }
  | { type: 'rect'; x: number; y: number; w: number; h: number; color: string; width: number }
  | { type: 'text'; x: number; y: number; text: string; color: string; size: number }
  | { type: 'free'; points: [number, number][]; color: string; width: number }
