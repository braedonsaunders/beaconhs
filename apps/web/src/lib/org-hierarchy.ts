import 'server-only'
import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'

/**
 * Org-unit hierarchy levels. The internal `customer` key is branded as
 * "Location" across the whole UI — the Locations module *is* the customer
 * level. Keep the keys untouched (DB enum `org_unit_level`, level filters,
 * audit `level` fields); only the display labels change here.
 */
export type OrgLevel = 'customer' | 'project' | 'site' | 'area'

export const ORG_LEVELS = ['customer', 'project', 'site', 'area'] as const

export type TenantHierarchy = Record<OrgLevel, boolean>

/** Mirrors the column default in `tenants.hierarchy`. */
export const DEFAULT_HIERARCHY: TenantHierarchy = {
  customer: true,
  project: true,
  site: true,
  area: false,
}

const LABELS: Record<OrgLevel, { one: string; many: string }> = {
  customer: { one: 'Location', many: 'Locations' },
  project: { one: 'Project', many: 'Projects' },
  site: { one: 'Site', many: 'Sites' },
  area: { one: 'Area', many: 'Areas' },
}

/** Display label for a level — singular by default, plural when asked. */
export function levelLabel(level: OrgLevel, opts?: { plural?: boolean }): string {
  return opts?.plural ? LABELS[level].many : LABELS[level].one
}

/**
 * This tenant's enabled hierarchy depths. Reads the global tenants row on the
 * super pool (the same pattern the app layout and admin settings use — the
 * tenants table isn't tenant-scoped). Memoised per request so multiple
 * consumers in one render share a single query.
 */
export const getTenantHierarchy = cache(async (tenantId: string): Promise<TenantHierarchy> => {
  const row = await withSuperAdmin(db, async (tx) => {
    const [t] = await tx
      .select({ hierarchy: tenants.hierarchy })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    return t
  })
  return { ...DEFAULT_HIERARCHY, ...(row?.hierarchy ?? {}) }
})
