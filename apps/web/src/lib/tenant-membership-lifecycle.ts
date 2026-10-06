import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { people, roleAssignments, tenantUsers, userPermissionOverrides } from '@beaconhs/db/schema'

/** Caller holds the membership row lock; preserve the identity referenced by safety history. */
export async function removeTenantMembership(tx: Database, tenantId: string, membershipId: string) {
  const [removed] = await tx
    .update(tenantUsers)
    .set({ status: 'suspended', removedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(tenantUsers.tenantId, tenantId),
        eq(tenantUsers.id, membershipId),
        isNull(tenantUsers.removedAt),
      ),
    )
    .returning({ id: tenantUsers.id, userId: tenantUsers.userId })
  if (!removed) return false
  await releasePersonLink(tx, tenantId, removed.userId)
  await clearMembershipGrants(tx, tenantId, membershipId)
  return true
}

async function releasePersonLink(tx: Database, tenantId: string, userId: string) {
  await tx
    .update(people)
    .set({ userId: null, updatedAt: new Date() })
    .where(and(eq(people.tenantId, tenantId), eq(people.userId, userId)))
    .returning({ id: people.id })
}

async function clearMembershipGrants(tx: Database, tenantId: string, membershipId: string) {
  await tx
    .delete(roleAssignments)
    .where(
      and(eq(roleAssignments.tenantId, tenantId), eq(roleAssignments.tenantUserId, membershipId)),
    )
  await tx
    .delete(userPermissionOverrides)
    .where(
      and(
        eq(userPermissionOverrides.tenantId, tenantId),
        eq(userPermissionOverrides.tenantUserId, membershipId),
      ),
    )
}

/** A fresh invitation/access grant reuses historical identity, never its old permissions. */
export async function restoreRemovedMembership(
  tx: Database,
  input: {
    tenantId: string
    userId: string
    displayName: string | null
    invitedBy: string
    invitedAt: Date
    status: 'active' | 'invited'
  },
) {
  const [existing] = await tx
    .select()
    .from(tenantUsers)
    .where(and(eq(tenantUsers.tenantId, input.tenantId), eq(tenantUsers.userId, input.userId)))
    .limit(1)
    .for('update')
  if (!existing?.removedAt) return null
  await releasePersonLink(tx, input.tenantId, input.userId)
  await clearMembershipGrants(tx, input.tenantId, existing.id)
  const invitedAt = new Date(
    Math.max(input.invitedAt.getTime(), (existing.invitedAt?.getTime() ?? 0) + 1),
  )
  const [restored] = await tx
    .update(tenantUsers)
    .set({
      ...input,
      invitedAt,
      removedAt: null,
      joinedAt: input.status === 'active' ? invitedAt : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tenantUsers.tenantId, input.tenantId),
        eq(tenantUsers.id, existing.id),
        isNotNull(tenantUsers.removedAt),
      ),
    )
    .returning()
  return restored ?? null
}
