import { relations } from 'drizzle-orm'
import { boolean, index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'

// Permission keys are strings: `module.action[.qualifier]`.
// e.g. `incidents.create`, `incidents.read.all`, `forms.publish`.
export type PermissionKey = string

export const roles = pgTable(
  'roles',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(), // e.g. 'worker', 'foreman', custom slugs
    name: text('name').notNull(),
    description: text('description'),
    isBuiltIn: boolean('is_built_in').default(false).notNull(),
    permissions: jsonb('permissions').$type<PermissionKey[]>().default([]).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantKeyUx: uniqueIndex('roles_tenant_key_ux').on(t.tenantId, t.key),
    tenantIdx: index('roles_tenant_idx').on(t.tenantId),
  }),
)

// Scope JSON shape:
//   { type: 'tenant' }                                 — everything in tenant
//   { type: 'sites', siteIds: ['…','…'] }
//   { type: 'crews', crewIds: ['…'] }
//   { type: 'self' }                                   — only own records
export type RoleScope =
  | { type: 'tenant' }
  | { type: 'sites'; siteIds: string[] }
  | { type: 'crews'; crewIds: string[] }
  | { type: 'self' }

export const roleAssignments = pgTable(
  'role_assignments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tenantUserId: uuid('tenant_user_id')
      .notNull()
      .references(() => tenantUsers.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    scope: jsonb('scope').$type<RoleScope>().notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('role_assignments_tenant_idx').on(t.tenantId),
    userIdx: index('role_assignments_user_idx').on(t.tenantUserId),
    roleIdx: index('role_assignments_role_idx').on(t.roleId),
  }),
)

export const rolesRelations = relations(roles, ({ many, one }) => ({
  tenant: one(tenants, { fields: [roles.tenantId], references: [tenants.id] }),
  assignments: many(roleAssignments),
}))

export const roleAssignmentsRelations = relations(roleAssignments, ({ one }) => ({
  tenant: one(tenants, { fields: [roleAssignments.tenantId], references: [tenants.id] }),
  tenantUser: one(tenantUsers, {
    fields: [roleAssignments.tenantUserId],
    references: [tenantUsers.id],
  }),
  role: one(roles, { fields: [roleAssignments.roleId], references: [roles.id] }),
}))

// Catalogue of built-in permission keys (consumed by UI permission picker).
export const PERMISSION_CATALOGUE = [
  // Forms
  'forms.template.read',
  'forms.template.create',
  'forms.template.publish',
  'forms.template.delete',
  // Prompt the AI to generate an App (form schema) or Flow (automation graph).
  'forms.ai.generate',
  'forms.response.read.all',
  'forms.response.read.site',
  'forms.response.read.self',
  'forms.response.create',
  'forms.response.update.own',
  'forms.response.delete',
  // Incidents
  'incidents.read.all',
  'incidents.read.site',
  'incidents.read.self',
  'incidents.create',
  'incidents.update',
  'incidents.investigate',
  'incidents.close',
  // Training
  'training.read.all',
  'training.read.self',
  'training.course.manage',
  'training.class.manage',
  'training.record.create',
  'training.matrix.manage',
  // Equipment
  'equipment.read.all',
  'equipment.read.site',
  'equipment.manage',
  'equipment.inspect',
  'equipment.workorder.create',
  'equipment.workorder.close',
  // PPE
  'ppe.read.all',
  'ppe.issue',
  'ppe.return',
  'ppe.inspect',
  // Documents
  'documents.read',
  'documents.manage',
  'documents.acknowledge',
  'documents.review',
  // Journals
  'journals.read.all',
  'journals.read.site',
  'journals.read.self',
  'journals.create',
  'journals.update.own',
  'journals.submit',
  'journals.assign',
  // Corrective actions
  'ca.read.all',
  'ca.read.site',
  'ca.read.self',
  'ca.create',
  'ca.update',
  'ca.verify',
  // Compliance — the unified obligations hub + cross-module rollups (/compliance).
  // `read` = view the hub; `manage` = enable/disable/delete obligations + hub config;
  // `assign` = create obligations + edit audience/schedule (supersedes journals.assign).
  'compliance.read',
  'compliance.manage',
  'compliance.assign',
  // Confined space
  'cs.permit.open',
  'cs.permit.close',
  'cs.atmospheric.record',
  // Lone worker
  'loneworker.start',
  'loneworker.supervise',
  // Reports
  'reports.read',
  'reports.builder',
  'reports.schedule',
  // Dashboards
  'dashboards.read',
  'dashboards.edit',
  // Admin
  'admin.users.manage',
  'admin.roles.manage',
  'admin.org.manage',
  'admin.plugins.manage',
  'admin.api-keys.manage',
  'admin.settings.manage',
  'admin.audit.read',
  // Edit the per-tenant sidebar navigation (/admin/navigation).
  'admin.nav.manage',
] as const

export type CataloguePermission = (typeof PERMISSION_CATALOGUE)[number]

// Built-in role definitions, seeded per tenant.
export const BUILTIN_ROLES: Record<
  string,
  { name: string; description: string; permissions: CataloguePermission[] }
> = {
  worker: {
    name: 'Worker',
    description: 'Field worker. Completes assigned forms, reports incidents, views own training.',
    permissions: [
      'forms.response.read.self',
      'forms.response.create',
      'forms.response.update.own',
      'incidents.read.self',
      'incidents.create',
      'training.read.self',
      'documents.read',
      'documents.acknowledge',
      'ca.read.self',
      'journals.read.self',
      'journals.create',
      'journals.update.own',
      'journals.submit',
      'loneworker.start',
    ],
  },
  foreman: {
    name: 'Foreman / Supervisor',
    description: 'Supervises a crew or site. Reviews submissions and assigns work.',
    permissions: [
      'forms.template.read',
      'forms.response.read.site',
      'forms.response.create',
      'incidents.read.site',
      'incidents.create',
      'incidents.update',
      'training.read.all',
      'equipment.read.site',
      'equipment.inspect',
      'ppe.issue',
      'ppe.inspect',
      'documents.read',
      'ca.read.site',
      'ca.create',
      'ca.update',
      'journals.read.site',
      'journals.create',
      'journals.submit',
      'journals.assign',
      'compliance.read',
      'compliance.assign',
      'cs.permit.open',
      'cs.permit.close',
      'cs.atmospheric.record',
      'loneworker.supervise',
      'reports.read',
      'dashboards.read',
    ],
  },
  safety_manager: {
    name: 'Safety Manager',
    description: 'Owns the H&S program. Builds forms, reviews everything, runs reports.',
    permissions: [
      'forms.template.read',
      'forms.template.create',
      'forms.template.publish',
      'forms.ai.generate',
      'forms.response.read.all',
      'forms.response.create',
      'incidents.read.all',
      'incidents.create',
      'incidents.update',
      'incidents.investigate',
      'incidents.close',
      'training.read.all',
      'training.course.manage',
      'training.class.manage',
      'training.record.create',
      'training.matrix.manage',
      'equipment.read.all',
      'equipment.manage',
      'equipment.inspect',
      'equipment.workorder.create',
      'equipment.workorder.close',
      'ppe.read.all',
      'ppe.issue',
      'ppe.return',
      'ppe.inspect',
      'documents.read',
      'documents.manage',
      'documents.review',
      'ca.read.all',
      'ca.create',
      'ca.update',
      'ca.verify',
      'journals.read.all',
      'journals.create',
      'journals.submit',
      'journals.assign',
      'compliance.read',
      'compliance.manage',
      'compliance.assign',
      'cs.permit.open',
      'cs.permit.close',
      'cs.atmospheric.record',
      'loneworker.supervise',
      'reports.read',
      'reports.builder',
      'reports.schedule',
      'dashboards.read',
      'dashboards.edit',
    ],
  },
  tenant_admin: {
    name: 'Tenant Admin',
    description: 'Full administrative control of the tenant. Manages users, roles, settings.',
    permissions: PERMISSION_CATALOGUE as unknown as CataloguePermission[],
  },
}
