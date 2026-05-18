// Cross-tenant tables: tenants, users, memberships, sessions.
// These do NOT have RLS — tenant scoping happens elsewhere.

import { relations } from 'drizzle-orm'
import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
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
    // Hierarchy depth toggles: { customer, project, site, area }
    hierarchy: jsonb('hierarchy')
      .$type<{ customer: boolean; project: boolean; site: boolean; area: boolean }>()
      .default({ customer: true, project: true, site: true, area: false })
      .notNull(),
    // Branding: { logoUrl, primaryColor, pdfLetterhead }
    branding: jsonb('branding')
      .$type<{ logoUrl?: string; primaryColor?: string; pdfLetterhead?: string }>()
      .default({})
      .notNull(),
    // Per-tenant feature flags / settings
    settings: jsonb('settings').$type<Record<string, unknown>>().default({}).notNull(),
    // Risk matrix config (null = no matrix, otherwise tenant-defined)
    riskMatrix: jsonb('risk_matrix').$type<RiskMatrixConfig | null>(),
    ...timestamps,
  },
  (t) => ({
    slugUx: uniqueIndex('tenants_slug_ux').on(t.slug),
  }),
)

export type RiskMatrixConfig = {
  axes: { severity: { values: string[] }; likelihood: { values: string[] } }
  // cell key is `${severityIdx}:${likelihoodIdx}`; value is { score, label, color }
  cells: Record<string, { score: number; label: string; color: string }>
}

export const userStatus = pgEnum('user_status', ['active', 'invited', 'suspended'])

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    name: text('name').notNull(),
    passwordHash: text('password_hash'), // null if magic-link only
    locale: text('locale').default('en').notNull(),
    timezone: text('timezone').default('America/Toronto').notNull(),
    status: userStatus('status').default('active').notNull(),
    isSuperAdmin: boolean('is_super_admin').default(false).notNull(),
    avatarUrl: text('avatar_url'),
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    emailUx: uniqueIndex('users_email_ux').on(t.email),
  }),
)

export const tenantUserStatus = pgEnum('tenant_user_status', ['active', 'invited', 'suspended'])

export const tenantUsers = pgTable(
  'tenant_users',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name'), // overrides users.name within this tenant
    status: tenantUserStatus('status').default('active').notNull(),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    invitedBy: uuid('invited_by').references(() => users.id),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    tenantUserUx: uniqueIndex('tenant_users_tenant_user_ux').on(t.tenantId, t.userId),
    tenantIdx: index('tenant_users_tenant_idx').on(t.tenantId),
    userIdx: index('tenant_users_user_idx').on(t.userId),
  }),
)

// Sessions are managed by Better-Auth; we mirror its expected schema.
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    activeTenantId: uuid('active_tenant_id').references(() => tenants.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    ...timestamps,
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
    expiresIdx: index('sessions_expires_idx').on(t.expiresAt),
  }),
)

export const tenantsRelations = relations(tenants, ({ many }) => ({
  members: many(tenantUsers),
}))

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(tenantUsers),
  sessions: many(sessions),
}))

export const tenantUsersRelations = relations(tenantUsers, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantUsers.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [tenantUsers.userId], references: [users.id] }),
}))
