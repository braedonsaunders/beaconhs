import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id } from './_helpers'
import { tenants } from './core'
import { complianceObligations } from './compliance'

/** The last observed rule and roster for a period. Evidence is evaluated separately. */
export type CompliancePeriodRule = Pick<
  typeof complianceObligations.$inferSelect,
  'title' | 'sourceModule' | 'subjectKind' | 'recurrence' | 'targetRef'
> & {
  workerType?: (typeof complianceObligations.$inferSelect)['workerType']
  createdAt: string
  members: { personId: string; userId: string | null; label: string }[]
}

export const compliancePeriodSnapshots = pgTable(
  'compliance_period_snapshots',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    obligationId: uuid('obligation_id').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    periodStartAt: timestamp('period_start_at', { withTimezone: true }).notNull(),
    periodEndAt: timestamp('period_end_at', { withTimezone: true }).notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    timezone: text('timezone').notNull(),
    rule: jsonb('rule').$type<CompliancePeriodRule>().notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    periodCheck: check(
      'compliance_period_snapshots_valid_period',
      sql`${t.periodEndAt} > ${t.periodStartAt} AND ${t.periodEnd} >= ${t.periodStart}`,
    ),
    periodUx: uniqueIndex('compliance_period_snapshots_period_ux').on(
      t.tenantId,
      t.obligationId,
      t.periodStartAt,
      t.periodEndAt,
    ),
    historyIdx: index('compliance_period_snapshots_history_idx').on(
      t.tenantId,
      t.obligationId,
      t.periodEndAt,
    ),
    obligationFk: foreignKey({
      name: 'compliance_period_snapshots_obligation_fk',
      columns: [t.tenantId, t.obligationId],
      foreignColumns: [complianceObligations.tenantId, complianceObligations.id],
    }).onDelete('cascade'),
  }),
)
