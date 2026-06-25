// Notification groups — a reusable, named AUDIENCE that any notification (native
// module cockpit, Flows send_email/notify, or an on-demand "Send email" button)
// can target instead of hand-listing roles + people every time.
//
// Membership is COMPOSABLE: a group is the union of member rows, each of which
// references a different grouping primitive (a person, a role, a department, an
// org-unit/site, a trade, a crew, or an existing person-group) — plus optional
// `exclude` rows that subtract people back out. The whole thing resolves at
// send-time via the canonical `resolveObligationAudience` (packages/compliance),
// so "everyone in the Safety Manager role + the Night Crew + 2 named people,
// minus Jane" is one group.
//
// Deliberately NOT the same as `person_groups` (which is a flat static tag of
// people) — a notification group can INCLUDE a person_group as one member kind.

import { relations } from 'drizzle-orm'
import { index, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants } from './core'

// Mirrors the compliance `audience_kind` taxonomy + adds `crew`/`person_group`.
export const notificationGroupMemberKind = pgEnum('notification_group_member_kind', [
  'everyone',
  'person',
  'role',
  'department',
  'org_unit',
  'trade',
  'crew',
  'person_group',
])

export const notificationGroupMemberMode = pgEnum('notification_group_member_mode', [
  'include',
  'exclude',
])

export const notificationGroups = pgTable(
  'notification_groups',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color'), // hex chip colour, mirrors person_groups
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('notification_groups_tenant_idx').on(t.tenantId),
    tenantNameUx: uniqueIndex('notification_groups_tenant_name_ux').on(t.tenantId, t.name),
  }),
)

export const notificationGroupMembers = pgTable(
  'notification_group_members',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => notificationGroups.id, { onDelete: 'cascade' }),
    kind: notificationGroupMemberKind('kind').notNull(),
    // The referenced entity: people.id | role.key | department.id | org_unit.id |
    // trade.id | crew.id | person_group.id. Empty string for `everyone`.
    entityKey: text('entity_key').default('').notNull(),
    mode: notificationGroupMemberMode('mode').default('include').notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('notification_group_members_tenant_idx').on(t.tenantId),
    groupIdx: index('notification_group_members_group_idx').on(t.groupId),
    uniqueMember: uniqueIndex('notification_group_members_unique_ux').on(
      t.groupId,
      t.kind,
      t.entityKey,
      t.mode,
    ),
  }),
)

export const notificationGroupsRelations = relations(notificationGroups, ({ one, many }) => ({
  tenant: one(tenants, { fields: [notificationGroups.tenantId], references: [tenants.id] }),
  members: many(notificationGroupMembers),
}))

export const notificationGroupMembersRelations = relations(
  notificationGroupMembers,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [notificationGroupMembers.tenantId],
      references: [tenants.id],
    }),
    group: one(notificationGroups, {
      fields: [notificationGroupMembers.groupId],
      references: [notificationGroups.id],
    }),
  }),
)
