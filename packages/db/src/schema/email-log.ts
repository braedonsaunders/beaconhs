// Email log — every transactional / on-demand email the worker dispatches
// is recorded here so the support team can answer "did X get the email?"
// and so we can replay deliveries when a provider hiccups.
//
// `tenantId` is nullable because some platform-level sends (eg. magic-link)
// have no tenant scope; tenant-scoped rows still respect RLS via the
// allowlist in rls.ts.
//
// We keep both `htmlSize` + `textSize` (byte length, not chars) so the index
// can stay small and the body can still be inspected on the detail page —
// the body itself is fetched lazily by the viewer (separate query) to keep
// list-page payloads tight.

import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'

export const emailLogStatus = pgEnum('email_log_status', [
  'queued',
  'sent',
  'failed',
  'bounced',
  'opened',
])

export const emailLog = pgTable(
  'email_log',
  {
    id: id(),
    // Nullable: some platform sends (magic-link, signup confirmation) are
    // not tenant-scoped. Tenant-scoped rows MUST have this set.
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    // BullMQ job id, if the send went through the queue (most do).
    // Some sends go straight through `sendEmail()`; for those this is null.
    jobId: text('job_id'),
    // Provider message id from Resend, eg. 'msg_…' — null until 'sent'.
    providerMessageId: text('provider_message_id'),
    // Recipients are stored as a jsonb array of email strings so we can
    // index/filter by membership later. `recipientPrimary` is denormalised
    // so the list view doesn't have to crack the jsonb on every row.
    recipients: jsonb('recipients').$type<string[]>().default([]).notNull(),
    recipientPrimary: text('recipient_primary'),
    cc: jsonb('cc').$type<string[]>().default([]).notNull(),
    bcc: jsonb('bcc').$type<string[]>().default([]).notNull(),
    fromAddr: text('from_addr').notNull(),
    replyToAddr: text('reply_to_addr'),
    subject: text('subject').notNull(),
    // Body bytes — let support eyeball "did the email get truncated".
    htmlSize: integer('html_size').default(0).notNull(),
    textSize: integer('text_size').default(0).notNull(),
    // Bodies live on the detail row; the list page does not select these.
    htmlBody: text('html_body'),
    textBody: text('text_body'),
    status: emailLogStatus('status').default('queued').notNull(),
    // Category for filtering — e.g. 'incident_reported', 'ca_assigned',
    // 'document_send', 'magic_link', 'training_expiring'.
    categoryKey: text('category_key'),
    // Free-form metadata: { incidentId, retryAttempt, etc. }
    meta: jsonb('meta').$type<Record<string, unknown>>().default({}).notNull(),
    // Lifecycle timestamps
    sentAt: timestamp('sent_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    bouncedAt: timestamp('bounced_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('email_log_tenant_idx').on(t.tenantId, t.createdAt),
    statusIdx: index('email_log_status_idx').on(t.tenantId, t.status, t.createdAt),
    categoryIdx: index('email_log_category_idx').on(t.tenantId, t.categoryKey, t.createdAt),
    recipientIdx: index('email_log_recipient_idx').on(t.recipientPrimary, t.createdAt),
    jobIdx: index('email_log_job_idx').on(t.jobId),
  }),
)

export type EmailLogRow = typeof emailLog.$inferSelect
export type EmailLogInsert = typeof emailLog.$inferInsert
