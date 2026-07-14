import { sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { roleAssignments, type RoleScope } from '@beaconhs/db/schema'

type RoleAssignmentUpsert = {
  tenantId: string
  tenantUserId: string
  roleId: string
  scope: RoleScope
}

/**
 * Set one or more member/role assignments atomically.
 *
 * Re-selecting an existing role means "replace its scope" throughout the
 * administration UI. The database enforces one row per
 * (tenant, member, role), so every writer must use the same conflict target
 * instead of a check-then-insert branch that can race with another request.
 */
export async function upsertRoleAssignments(
  tx: Database,
  assignments: readonly RoleAssignmentUpsert[],
): Promise<string[]> {
  if (assignments.length === 0) return []

  const rows = await tx
    .insert(roleAssignments)
    .values([...assignments])
    .onConflictDoUpdate({
      target: [roleAssignments.tenantId, roleAssignments.tenantUserId, roleAssignments.roleId],
      set: {
        scope: sql`excluded.scope`,
        updatedAt: sql`now()`,
      },
      // A repeated save of the same scope is a real no-op. PostgreSQL omits it
      // from RETURNING, which lets callers avoid false "changed" notices and
      // audit entries while remaining race-safe.
      setWhere: sql`${roleAssignments.scope} IS DISTINCT FROM excluded.scope`,
    })
    .returning({ membershipId: roleAssignments.tenantUserId })

  return rows.map((row) => row.membershipId)
}
