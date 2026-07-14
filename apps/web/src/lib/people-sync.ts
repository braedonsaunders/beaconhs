// Sync provenance for a person. A person created or maintained by a data-sync
// connection has a `sync_crosswalk` row pointing at it. Schedule enablement is
// deliberately irrelevant: a manual-only connection still owns its records.
// Deleting the connection transactionally removes its crosswalks and hands the
// records back to manual editing.
//
// This is what makes the directory standalone-capable: with no sync owner,
// every person is fully editable; with one, the fields that connection owns are
// locked at the source.

import { and, eq, isNull } from 'drizzle-orm'
import { syncConnections, syncCrosswalk } from '@beaconhs/db/schema'
import type { Database } from '@beaconhs/db'

type PersonSyncOrigin = {
  connectionId: string
  connectionName: string
  connectorKey: string
  sourceSystem: string
}

/** The fields a sync owns and writes on every run (see @beaconhs/sync upsertPerson). */
export const SYNC_OWNED_PERSON_FIELDS = [
  'firstName',
  'lastName',
  'employeeNo',
  'email',
  'phone',
  'hireDate',
  'departmentId',
  'tradeId',
  'status',
] as const

/**
 * Relationships written by the people sync engine. A connector's scalar
 * `jobTitle` value becomes the person's canonical primary title assignment;
 * secondary titles remain app-managed. The current people editor changes the
 * full title set in one operation, so it must lock that control while a sync is
 * active rather than risk deleting or replacing the source-owned primary.
 */
export const SYNC_OWNED_PERSON_RELATIONSHIPS = ['titles'] as const

/**
 * Returns the active sync origin for a person, or null when the person is
 * managed manually. Call inside a `ctx.db((tx) => …)` so it runs under the same
 * RLS-bounded transaction as the surrounding read/write.
 */
export async function getPersonSyncOrigin(
  tx: Database,
  personId: string,
): Promise<PersonSyncOrigin | null> {
  const [row] = await tx
    .select({
      connectionId: syncConnections.id,
      connectionName: syncConnections.name,
      connectorKey: syncConnections.connectorKey,
      sourceSystem: syncCrosswalk.sourceSystem,
    })
    .from(syncCrosswalk)
    .innerJoin(syncConnections, eq(syncConnections.id, syncCrosswalk.connectionId))
    .where(
      and(
        eq(syncCrosswalk.entity, 'people'),
        eq(syncCrosswalk.canonicalId, personId),
        isNull(syncConnections.deletedAt),
      ),
    )
    .limit(1)
  return row ?? null
}
