import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'
import { equipmentItems } from './equipment'
import type { ServiceRule } from '../equipment-service'

export const equipmentMeters = pgTable(
  'equipment_meters',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    equipmentItemId: uuid('equipment_item_id').notNull(),
    name: text('name').notNull(),
    unit: text('unit').notNull(),
    currentValue: numeric('current_value', { precision: 16, scale: 3 }),
    readOn: date('read_on'),
    ...timestamps,
  },
  (t) => ({
    tenantIdIdUx: uniqueIndex('equipment_meters_tenant_id_id_ux').on(t.tenantId, t.id),
    itemIdx: index('equipment_meters_item_idx').on(t.tenantId, t.equipmentItemId),
    itemFk: foreignKey({
      name: 'equipment_meters_tenant_item_fk',
      columns: [t.tenantId, t.equipmentItemId],
      foreignColumns: [equipmentItems.tenantId, equipmentItems.id],
    }).onDelete('cascade'),
    valueCheck: check(
      'equipment_meters_value_ck',
      sql`${t.currentValue} is null or ${t.currentValue} >= 0`,
    ),
  }),
)
export const equipmentServicePlans = pgTable(
  'equipment_service_plans',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    equipmentItemId: uuid('equipment_item_id').notNull(),
    name: text('name').notNull(),
    notes: text('notes'),
    category: text('category').$type<'oil_change'>(),
    rules: jsonb('rules').$type<ServiceRule[]>().notNull(),
    lastReadings: jsonb('last_readings').$type<Record<string, number>>().default({}).notNull(),
    match: text('match').$type<'any' | 'all'>().default('any').notNull(),
    lastCompletedOn: date('last_completed_on'),
    isActive: boolean('is_active').default(true).notNull(),
    cycleId: uuid('cycle_id').defaultRandom().notNull(),
    notifiedCycleId: uuid('notified_cycle_id'),
    ...timestamps,
  },
  (t) => ({
    tenantIdIdUx: uniqueIndex('equipment_service_plans_tenant_id_id_ux').on(t.tenantId, t.id),
    itemIdx: index('equipment_service_plans_item_idx').on(t.tenantId, t.equipmentItemId),
    itemFk: foreignKey({
      name: 'equipment_service_plans_tenant_item_fk',
      columns: [t.tenantId, t.equipmentItemId],
      foreignColumns: [equipmentItems.tenantId, equipmentItems.id],
    }).onDelete('cascade'),
    matchCheck: check('equipment_service_plans_match_ck', sql`${t.match} in ('any','all')`),
    rulesCheck: check(
      'equipment_service_plans_rules_ck',
      sql`jsonb_typeof(${t.rules})='array' and jsonb_array_length(${t.rules}) between 1 and 12`,
    ),
  }),
)
