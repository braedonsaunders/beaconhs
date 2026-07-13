// Sync provenance for org units (Locations / Projects / Sites — the shared
// org_units table). An org unit created or maintained by a data-sync connection
// has a `sync_crosswalk` row (entity `org_unit`) pointing at it. We treat the
// unit as "actively synced" only while that connection is still ENABLED —
// disabling or removing the connection hands the record back to manual editing.
//
// Mirrors people-sync.ts so the org hierarchy admin can lock synced units the
// same way the people directory locks synced people.

import { and, eq, inArray, isNull } from 'drizzle-orm'
import { syncConnections, syncCrosswalk } from '@beaconhs/db/schema'
import type { Database } from '@beaconhs/db'

type OrgUnitSyncOrigin = {
  connectionId: string
  connectionName: string
  connectorKey: string
  sourceSystem: string
}

/**
 * Active sync origins for a set of org units, keyed by org-unit id. Units absent
 * from the map are managed manually. Call inside a `ctx.db((tx) => …)` so it
 * runs under the same RLS-bounded transaction as the surrounding read.
 */
export async function getOrgUnitSyncOrigins(
  tx: Database,
  orgUnitIds: string[],
): Promise<Map<string, OrgUnitSyncOrigin>> {
  if (orgUnitIds.length === 0) return new Map()
  const rows = await tx
    .select({
      orgUnitId: syncCrosswalk.canonicalId,
      connectionId: syncConnections.id,
      connectionName: syncConnections.name,
      connectorKey: syncConnections.connectorKey,
      sourceSystem: syncCrosswalk.sourceSystem,
    })
    .from(syncCrosswalk)
    .innerJoin(syncConnections, eq(syncConnections.id, syncCrosswalk.connectionId))
    .where(
      and(
        eq(syncCrosswalk.entity, 'org_unit'),
        inArray(syncCrosswalk.canonicalId, orgUnitIds),
        eq(syncConnections.enabled, true),
        isNull(syncConnections.deletedAt),
      ),
    )
  const map = new Map<string, OrgUnitSyncOrigin>()
  for (const r of rows) {
    map.set(r.orgUnitId, {
      connectionId: r.connectionId,
      connectionName: r.connectionName,
      connectorKey: r.connectorKey,
      sourceSystem: r.sourceSystem,
    })
  }
  return map
}

/** True when the given org unit is actively synced from an external system. */
export async function isOrgUnitSynced(tx: Database, orgUnitId: string): Promise<boolean> {
  const origins = await getOrgUnitSyncOrigins(tx, [orgUnitId])
  return origins.has(orgUnitId)
}
