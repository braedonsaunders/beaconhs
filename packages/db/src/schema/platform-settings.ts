// Deployment-wide settings a super-admin manages once for ALL tenants — not
// tenant-scoped. A single row keyed by a fixed sentinel id (upserted). This is a
// GLOBAL table like `tenants` / the Better-Auth tables, so it is deliberately
// NOT registered in TENANT_SCOPED_TABLES (rls.ts) — no RLS policy applies.
//
// `email` holds the platform email provider + policy (a PlatformEmailConfig from
// @beaconhs/emails); `sms` holds the platform SMS provider + policy (a
// PlatformSmsConfig from @beaconhs/sms); `ai` holds the platform AI provider +
// policy (a PlatformAiConfig — see apps/web ai-config). Readers cast them. The
// policy `mode` on each governs whether tenants may configure their own provider
// and the global kill switch for that channel.

import { jsonb, pgTable, uuid } from 'drizzle-orm/pg-core'
import { timestamps } from './_helpers'

/** The single platform_settings row id. */
export const PLATFORM_SETTINGS_ID = '00000000-0000-0000-0000-000000000001'

export const platformSettings = pgTable('platform_settings', {
  id: uuid('id').primaryKey(),
  email: jsonb('email').$type<Record<string, unknown>>().default({}).notNull(),
  sms: jsonb('sms').$type<Record<string, unknown>>().default({}).notNull(),
  ai: jsonb('ai').$type<Record<string, unknown>>().default({}).notNull(),
  ...timestamps,
})

export type PlatformSettingsRow = typeof platformSettings.$inferSelect
export type PlatformSettingsInsert = typeof platformSettings.$inferInsert
