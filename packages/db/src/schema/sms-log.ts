// SMS log — every text message the notification worker dispatches is recorded
// here so the support team can answer "did X get the SMS?" and see provider
// failures. The sibling of email_log, adapted for SMS: a single recipient phone
// (not an array), a plain-text body (no html), and an SMS-specific status set.
//
// Unlike email (a dedicated queue + worker), SMS is sent inline in the notify
// worker, so each row is written once with its terminal status — there is no
// 'queued' transient state. `tenantId` is kept nullable to match email_log's
// RLS pattern (the tenant_isolation policy hides NULL rows from tenant context;
// the /admin/sms-log viewer uses withSuperAdmin).

import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'

export const smsLogStatus = pgEnum('sms_log_status', ['sent', 'failed', 'suppressed', 'skipped'])

export const smsLog = pgTable(
  'sms_log',
  {
    id: id(),
    // Always set in practice (SMS is tenant-scoped); nullable mirrors email_log.
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    // BullMQ notify job id that produced this send.
    jobId: text('job_id'),
    // Provider message id / SID (Twilio SMxx…, etc.) — null until/unless 'sent'.
    providerMessageId: text('provider_message_id'),
    // Which provider actually sent it: twilio | vonage | messagebird | plivo |
    // telnyx | env (legacy TWILIO_* fallback).
    provider: text('provider'),
    // Destination phone (E.164). Null for 'suppressed' (kill switch, pre-send).
    recipient: text('recipient'),
    // The message text as sent (already truncated to the 1500-char send cap).
    body: text('body'),
    bodyLength: integer('body_length').default(0).notNull(),
    status: smsLogStatus('status').default('sent').notNull(),
    // Notification category for filtering — e.g. 'incident', 'ca', 'lone_worker'.
    categoryKey: text('category_key'),
    // Free-form metadata: { userEmail, recipients, attempt, … }
    meta: jsonb('meta').$type<Record<string, unknown>>().default({}).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('sms_log_tenant_idx').on(t.tenantId, t.createdAt),
    statusIdx: index('sms_log_status_idx').on(t.tenantId, t.status, t.createdAt),
    categoryIdx: index('sms_log_category_idx').on(t.tenantId, t.categoryKey, t.createdAt),
    recipientIdx: index('sms_log_recipient_idx').on(t.recipient, t.createdAt),
    jobIdx: index('sms_log_job_idx').on(t.jobId),
  }),
)

export type SmsLogRow = typeof smsLog.$inferSelect
export type SmsLogInsert = typeof smsLog.$inferInsert
