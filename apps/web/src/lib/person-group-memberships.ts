import { sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'

/**
 * Serialize the person-group membership graph per tenant. Membership rows have
 * two valid admin entrypoints (group-centric and person-centric), plus bulk
 * assignment, and each write must update the denormalized people.group_ids
 * cache in the same transaction. A tenant-scoped transaction advisory lock is
 * the single ordering point that prevents those entrypoints from interleaving.
 */
export async function lockPersonGroupMembershipGraph(
  tx: Database,
  tenantId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${'beaconhs:person-groups:' + tenantId}, 0))`,
  )
}

/** Rebuild the canonical group-id cache after a membership mutation. */
export async function refreshPersonGroupCache(
  tx: Database,
  tenantId: string,
  personIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(personIds)].sort((a, b) => a.localeCompare(b))
  if (ids.length === 0) return
  await tx.execute(sql`
    UPDATE people
    SET group_ids = COALESCE((
      SELECT jsonb_agg(group_id ORDER BY group_id)
      FROM person_group_memberships
      WHERE person_id = people.id AND tenant_id = ${tenantId}
    ), '[]'::jsonb)
    WHERE id IN (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
      AND tenant_id = ${tenantId}
  `)
}
