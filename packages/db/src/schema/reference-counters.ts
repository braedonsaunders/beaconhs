// Atomic per-tenant reference-number counters. Replaces the count-based
// `SELECT count(*) … + 1` scheme that every module used to mint human references
// (INC-2026-0001, CA-2026-0042, …) — that scheme both races (two concurrent
// creates read the same count and mint the same reference) and drifts (a deleted
// record lowers the count, so the next reference collides with an existing one).
//
// nextReference() bumps the row for (tenant, entity, period) with a single
// `INSERT … ON CONFLICT DO UPDATE SET seq = seq + 1 RETURNING seq`, which takes a
// row lock and hands out a strictly-increasing sequence with no gaps-cause-reuse.

import { integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'

export const referenceCounters = pgTable(
  'reference_counters',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Logical entity the reference belongs to: 'incident', 'corrective_action',
    // 'inspection', 'equipment_inspection', 'work_order', 'hazid', 'journal',
    // 'safe_distance'. Shared by every code path that mints that entity's
    // references so the counter is authoritative across create surfaces.
    entity: text('entity').notNull(),
    // Reset boundary — the 4-digit year the reference is scoped to ('2026').
    period: text('period').notNull(),
    seq: integer('seq').notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    scopeUx: uniqueIndex('reference_counters_scope_ux').on(t.tenantId, t.entity, t.period),
  }),
)
