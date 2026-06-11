// Unified compliance scan. Once a day: for every tenant, re-materialise every
// active obligation into compliance_status (the scoreboard the hub reads) and
// emit an overdue/expiring reminder per obligation that has out-of-compliance
// subjects. Obligation create/update materialise instantly on the write path,
// so this is the periodic refresh + the reminder driver.

import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'
import { materializeTenant } from '@beaconhs/compliance'
import { emitComplianceObligationOverdue } from '@beaconhs/events'

export type ComplianceScanResult = {
  tenants: number
  obligations: number
  reminders: number
  errors: number
}

export async function scanCompliance(): Promise<ComplianceScanResult> {
  const result: ComplianceScanResult = { tenants: 0, obligations: 0, reminders: 0, errors: 0 }
  const tenantRows = await withSuperAdmin(db, (tx) => tx.select({ id: tenants.id }).from(tenants))

  for (const t of tenantRows) {
    result.tenants += 1
    let materialized: Awaited<ReturnType<typeof materializeTenant>> = []
    try {
      // Per-tenant RLS context so reads + the compliance_status upsert are scoped.
      materialized = await withTenant(db, t.id, (tx) => materializeTenant(tx, t.id))
    } catch (err) {
      result.errors += 1
      console.warn(
        `[compliance_scan] tenant ${t.id} failed: ${err instanceof Error ? err.message : err}`,
      )
      continue
    }
    result.obligations += materialized.length
    for (const { obligation, result: ev } of materialized) {
      if (ev.totals.overdue > 0) {
        await emitComplianceObligationOverdue(t.id, obligation.id, ev.totals.overdue)
        result.reminders += 1
      }
    }
  }
  return result
}
