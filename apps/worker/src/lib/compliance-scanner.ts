// Unified compliance scan — the single detection brain. Once a day: for every
// tenant, re-materialise every active obligation into compliance_status (the
// scoreboard the hub reads) and emit PERSON-TARGETED alerts for the subjects
// whose status changed this run (pending→overdue, →expiring). Obligation
// create/update materialise instantly on the write path, so this is the periodic
// refresh + the transition-driven alert driver. Firing only on transitions means
// a still-overdue item never re-spams; escalation re-reminders are layered on by
// the routing engine (Phase 2), not by re-firing here.

import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'
import { materializeTenant } from '@beaconhs/compliance'
import { emitComplianceTransitions } from '@beaconhs/events'

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
    for (const { obligation, transitions } of materialized) {
      const actionable = transitions.filter((t) => t.to === 'overdue' || t.to === 'expiring')
      if (actionable.length > 0) {
        await emitComplianceTransitions(t.id, obligation.id, actionable)
        result.reminders += 1
      }
    }
  }
  return result
}
