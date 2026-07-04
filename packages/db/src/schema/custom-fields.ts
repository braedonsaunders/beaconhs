// Tenant-defined custom fields for native entities (equipment, PPE, people,
// locations). One polymorphic definition table; values live on each record's
// existing `metadata` jsonb under the `custom` namespace (see
// @beaconhs/forms-core custom-fields helpers). This is the configurable,
// UI-driven replacement for the legacy "extra column with no admin UI" pattern.

import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { CustomFieldConfig } from '@beaconhs/forms-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants } from './core'

export const customFieldEntityKind = pgEnum('custom_field_entity_kind', [
  'equipment',
  'ppe',
  'person',
  'location',
])

export const customFieldType = pgEnum('custom_field_type', [
  'text',
  'textarea',
  'number',
  'date',
  'datetime',
  'boolean',
  'select',
  'multi_select',
  'url',
  'email',
  'phone',
])

export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Which native entity this field decorates.
    entityKind: customFieldEntityKind('entity_kind').notNull(),
    // Optional scope to a subtype (equipment_types.id / ppe_types.id). NULL =
    // applies to every record of the kind. No FK — the referenced table varies
    // by entityKind, and a dangling subtypeId simply widens visibility to all.
    subtypeId: uuid('subtype_id'),
    // Stable machine key — the property name under `metadata.custom`. Unique per
    // (tenant, entityKind) so a stored value maps unambiguously regardless of
    // which subtype scope surfaced it.
    key: text('key').notNull(),
    label: text('label').notNull(),
    helpText: text('help_text'),
    fieldType: customFieldType('field_type').notNull(),
    // Type-specific options/validation (choices, unit, min/max, placeholder).
    config: jsonb('config').$type<CustomFieldConfig | null>(),
    required: boolean('required').default(false).notNull(),
    // Section heading used to group fields on the record page / designer.
    groupLabel: text('group_label'),
    // Optional native field-group placement. When set (e.g. 'vehicle',
    // 'specifications' for equipment — see the web app's field-group
    // registry), the field renders inside that native section on the record
    // page instead of a standalone custom section.
    groupKey: text('group_key'),
    sortOrder: integer('sort_order').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantKindIdx: index('custom_field_definitions_tenant_kind_idx').on(t.tenantId, t.entityKind),
    subtypeIdx: index('custom_field_definitions_subtype_idx').on(t.subtypeId),
    // One key per (tenant, entityKind). Soft-deleted rows keep their key
    // reserved until purged — acceptable; the designer reuses/reactivates.
    tenantKindKeyUx: uniqueIndex('custom_field_definitions_tenant_kind_key_ux').on(
      t.tenantId,
      t.entityKind,
      t.key,
    ),
  }),
)

export const customFieldDefinitionsRelations = relations(customFieldDefinitions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [customFieldDefinitions.tenantId],
    references: [tenants.id],
  }),
}))
