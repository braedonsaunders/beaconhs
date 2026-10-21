// Optional, provider-neutral work-day decisions. Absence is unknown, not time off.
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { id, timestamps } from './_helpers'
import { tenants } from './core'
import { people } from './org'

export const personWorkDays = pgTable(
  'person_work_days',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').notNull(),
    workDate: date('work_date').notNull(),
    worked: boolean('worked').notNull(),
    source: text('source').notNull(),
    ...timestamps,
  },
  (t) => ({
    personFk: foreignKey({
      name: 'person_work_days_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }).onDelete('cascade'),
    personDateUx: uniqueIndex('person_work_days_person_date_ux').on(
      t.tenantId,
      t.personId,
      t.workDate,
    ),
    dateIdx: index('person_work_days_date_idx').on(t.tenantId, t.workDate),
    sourceCheck: check(
      'person_work_days_source_ck',
      sql`length(trim(${t.source})) between 1 and 100`,
    ),
  }),
)
