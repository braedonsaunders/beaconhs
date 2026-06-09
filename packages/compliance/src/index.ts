// @beaconhs/compliance — the unified compliance engine.
//
// One canonical audience resolver + per-module completion adapters, consumed by
// BOTH the web hub (live evaluation on read) and the worker scan (materialises
// compliance_status + reminders). Pure DB layer — depends only on @beaconhs/db
// + drizzle-orm; takes a `tx` + tenantId, never the web's RequestContext.

export * from './audience'
export * from './evaluate'
export * from './materialize'
