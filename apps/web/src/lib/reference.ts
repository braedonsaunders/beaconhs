import { sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'

// Human reference numbers (INC-2026-0001, CA-2026-0042, …) minted atomically
// from reference_counters. Replaces the old `SELECT count(*) … + 1` scheme,
// which raced (two concurrent creates read the same count → identical reference)
// and drifted (a deleted record lowered the count → a reused reference).

type ReferenceEntity =
  | 'incident'
  | 'corrective_action'
  | 'inspection'
  | 'equipment_inspection'
  | 'work_order'
  | 'hazid'
  | 'journal'
  | 'safe_distance'

const PREFIX: Record<ReferenceEntity, string> = {
  incident: 'INC',
  corrective_action: 'CA',
  inspection: 'INS',
  equipment_inspection: 'EQI',
  work_order: 'WO',
  hazid: 'HAZ',
  journal: 'JRN',
  safe_distance: 'SD',
}

/**
 * Atomically mint the next reference for an entity, formatted `PREFIX-YYYY-NNNN`.
 *
 * Must run inside `ctx.db((tx) => …)` so RLS pins the counter to the tenant. The
 * single `INSERT … ON CONFLICT DO UPDATE SET seq = seq + 1 RETURNING` row-locks
 * the counter row, so concurrent creators serialize and never collide. `year`
 * defaults to the current year; pass the record's own year when the reference is
 * keyed to when it happened rather than to now.
 */
export async function nextReference(
  tx: Database,
  tenantId: string,
  entity: ReferenceEntity,
  year: number = new Date().getFullYear(),
): Promise<string> {
  const period = String(year)
  const rows = await tx.execute<{ seq: number }>(sql`
    INSERT INTO reference_counters (tenant_id, entity, period, seq)
    VALUES (${tenantId}, ${entity}, ${period}, 1)
    ON CONFLICT (tenant_id, entity, period)
    DO UPDATE SET seq = reference_counters.seq + 1, updated_at = now()
    RETURNING seq
  `)
  const seq = Number((rows as unknown as Array<{ seq: number }>)[0]?.seq ?? 1)
  return `${PREFIX[entity]}-${period}-${String(seq).padStart(4, '0')}`
}
