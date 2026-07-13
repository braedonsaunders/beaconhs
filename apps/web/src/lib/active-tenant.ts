import 'server-only'

import { and, eq, type SQL } from 'drizzle-orm'
import { db, type Database } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'

/**
 * One operational-workspace invariant for human sessions, API keys, kiosks,
 * live badge transcripts, invite acceptance, and signed editor callbacks.
 * Platform administration deliberately does not use this helper: a platform
 * super-admin must still be able to inspect and restore an inactive tenant.
 */
export function activeTenantPredicate(tenantId?: string): SQL {
  return tenantId
    ? and(eq(tenants.id, tenantId), eq(tenants.status, 'active'))!
    : eq(tenants.status, 'active')
}

export function isActiveTenantStatus(status: string): boolean {
  return status === 'active'
}

export async function resolveActiveTenant(tx: Database, lookup: { id: string } | { slug: string }) {
  const identity = 'id' in lookup ? eq(tenants.id, lookup.id) : eq(tenants.slug, lookup.slug)
  const [tenant] = await tx
    .select()
    .from(tenants)
    .where(and(identity, activeTenantPredicate()))
    .limit(1)
  return tenant ?? null
}

/** Check a public signed callback before establishing tenant RLS scope. */
export async function tenantIsActive(tenantId: string): Promise<boolean> {
  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(activeTenantPredicate(tenantId))
    .limit(1)
  return Boolean(tenant)
}
