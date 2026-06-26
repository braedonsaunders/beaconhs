// Cross-tenant tables: tenants + Better-Auth core (user, session, account, verification) + tenant_users.
// The user/session/account/verification tables match Better-Auth 1.6.x's
// expected default schema (camelCase column names, singular table names).

import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'

export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended', 'archived'])

export const tenants = pgTable(
  'tenants',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: tenantStatus('status').default('active').notNull(),
    region: text('region').default('ca-central-1').notNull(),
    defaultLanguage: text('default_language').default('en').notNull(),
    enabledLanguages: jsonb('enabled_languages').$type<string[]>().default(['en']).notNull(),
    hierarchy: jsonb('hierarchy')
      .$type<{ customer: boolean; project: boolean; site: boolean; area: boolean }>()
      .default({ customer: true, project: true, site: true, area: false })
      .notNull(),
    branding: jsonb('branding')
      .$type<{ logoUrl?: string; primaryColor?: string; pdfLetterhead?: string }>()
      .default({})
      .notNull(),
    settings: jsonb('settings').$type<Record<string, unknown>>().default({}).notNull(),
    riskMatrix: jsonb('risk_matrix').$type<RiskMatrixConfig | null>(),
    // Optional hashed kiosk PIN — used by /kiosk?t=<slug> to authenticate the shared tablet.
    kioskPin: text('kiosk_pin'),
    ...timestamps,
  },
  (t) => ({
    slugUx: uniqueIndex('tenants_slug_ux').on(t.slug),
  }),
)

export type RiskMatrixConfig = {
  axes: { severity: { values: string[] }; likelihood: { values: string[] } }
  cells: Record<string, { score: number; label: string; color: string }>
}

// --- Better-Auth tables (singular names, camelCase columns) ---------------
// SQL column names use camelCase so they match what Better-Auth 1.6.x emits.

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    emailVerified: boolean('emailVerified').default(false).notNull(),
    name: text('name').notNull(),
    image: text('image'),
    isSuperAdmin: boolean('isSuperAdmin').default(false).notNull(),
    locale: text('locale').default('en').notNull(),
    timezone: text('timezone').default('America/Toronto').notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailUx: uniqueIndex('user_email_ux').on(t.email),
  }),
)

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    activeTenantId: uuid('activeTenantId'),
    // --- Admin impersonation overlay ---------------------------------------
    // When a privileged admin "views as" another user, the pointer lives on the
    // ADMIN's own session row: server-authoritative (the client can never set
    // it), un-forgeable, and it auto-dies when the admin signs out (the row is
    // deleted). getRequestContext() reads these to resolve the request as the
    // target user — pinned to impersonationTenantId, re-authorized every request
    // — while remembering the real actor. See apps/web/src/lib/impersonation.ts.
    impersonatingUserId: text('impersonating_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    impersonationTenantId: uuid('impersonation_tenant_id'),
    impersonationStartedAt: timestamp('impersonation_started_at', { withTimezone: true }),
    impersonationExpiresAt: timestamp('impersonation_expires_at', { withTimezone: true }),
    impersonationReason: text('impersonation_reason'),
    createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tokenUx: uniqueIndex('session_token_ux').on(t.token),
    userIdx: index('session_user_idx').on(t.userId),
    expiresIdx: index('session_expires_idx').on(t.expiresAt),
  }),
)

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    userId: text('userId')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('account_user_idx').on(t.userId),
    providerIdx: index('account_provider_idx').on(t.providerId, t.accountId),
  }),
)

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expiresAt', { withTimezone: true }).notNull(),
    createdAt: timestamp('createdAt', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updatedAt', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    identifierIdx: index('verification_identifier_idx').on(t.identifier),
  }),
)

// --- App tenant membership ------------------------------------------------

export const tenantUserStatus = pgEnum('tenant_user_status', ['active', 'invited', 'suspended'])

export const tenantUsers = pgTable(
  'tenant_users',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    displayName: text('display_name'),
    status: tenantUserStatus('status').default('active').notNull(),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    invitedBy: text('invited_by').references(() => user.id),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    tenantUserUx: uniqueIndex('tenant_users_tenant_user_ux').on(t.tenantId, t.userId),
    tenantIdx: index('tenant_users_tenant_idx').on(t.tenantId),
    userIdx: index('tenant_users_user_idx').on(t.userId),
  }),
)

// Aliases so plural names keep working in app code.
export const users = user
export const sessions = session

// --- Relations ------------------------------------------------------------

export const tenantsRelations = relations(tenants, ({ many }) => ({
  members: many(tenantUsers),
}))

export const userRelations = relations(user, ({ many }) => ({
  memberships: many(tenantUsers),
  sessions: many(session),
}))

export const tenantUsersRelations = relations(tenantUsers, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantUsers.tenantId], references: [tenants.id] }),
  user: one(user, { fields: [tenantUsers.userId], references: [user.id] }),
}))
