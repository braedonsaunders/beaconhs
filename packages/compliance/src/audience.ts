// Canonical audience resolver for the unified compliance engine.
//
// THE one implementation — replaces the six divergent copies that used to live
// in training/documents/inspections/journals/compliance modules + the worker.
// Union of every audience kind (everyone / person / role / trade / department /
// org_unit) with one consistent role-bridge policy (active members only).
//
// Returns BOTH the person id and the linked user id: the web needs personId for
// compliance status; the worker needs userId for notifications.

import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  people,
  peopleAssignments,
  personGroupMemberships,
  roleAssignments,
  roles,
  tenantUsers,
} from '@beaconhs/db/schema'

export type AudienceKind =
  | 'everyone'
  | 'person'
  | 'role'
  | 'trade'
  | 'department'
  | 'org_unit'
  | 'crew'
  | 'person_group'

export type AudienceItem = { kind: AudienceKind; entityKey: string }

export type ResolvedMember = { personId: string; userId: string | null }

/**
 * Resolve an obligation's audience rows to a deduplicated set of people
 * (id + linked user id). `everyone` short-circuits to all active people.
 * Always pins tenantId explicitly (the worker runs with RLS bypassed).
 */
export async function resolveObligationAudience(
  tx: Database,
  tenantId: string,
  audience: AudienceItem[],
): Promise<ResolvedMember[]> {
  if (audience.length === 0) return []
  const byId = new Map<string, string | null>()
  const add = (rows: { id: string; userId: string | null }[]) => {
    for (const r of rows) byId.set(r.id, r.userId)
  }

  const baseActive = and(
    eq(people.tenantId, tenantId),
    eq(people.status, 'active'),
    isNull(people.deletedAt),
  )

  if (audience.some((a) => a.kind === 'everyone')) {
    add(await tx.select({ id: people.id, userId: people.userId }).from(people).where(baseActive))
    return toList(byId)
  }

  const personIds = audience.filter((a) => a.kind === 'person').map((a) => a.entityKey)
  const tradeIds = audience.filter((a) => a.kind === 'trade').map((a) => a.entityKey)
  const departmentIds = audience.filter((a) => a.kind === 'department').map((a) => a.entityKey)
  const orgUnitIds = audience.filter((a) => a.kind === 'org_unit').map((a) => a.entityKey)
  const crewIds = audience.filter((a) => a.kind === 'crew').map((a) => a.entityKey)
  const personGroupIds = audience.filter((a) => a.kind === 'person_group').map((a) => a.entityKey)
  const roleKeys = audience.filter((a) => a.kind === 'role').map((a) => a.entityKey)

  if (personIds.length > 0) {
    add(
      await tx
        .select({ id: people.id, userId: people.userId })
        .from(people)
        .where(and(baseActive, inArray(people.id, personIds))),
    )
  }
  if (tradeIds.length > 0) {
    add(
      await tx
        .select({ id: people.id, userId: people.userId })
        .from(people)
        .where(and(baseActive, inArray(people.tradeId, tradeIds))),
    )
  }
  if (departmentIds.length > 0) {
    add(
      await tx
        .select({ id: people.id, userId: people.userId })
        .from(people)
        .where(and(baseActive, inArray(people.departmentId, departmentIds))),
    )
  }
  if (orgUnitIds.length > 0) {
    add(
      await tx
        .select({ id: people.id, userId: people.userId })
        .from(peopleAssignments)
        .innerJoin(people, eq(people.id, peopleAssignments.personId))
        .where(
          and(
            eq(peopleAssignments.tenantId, tenantId),
            inArray(peopleAssignments.orgUnitId, orgUnitIds),
            baseActive,
          ),
        ),
    )
  }
  if (crewIds.length > 0) {
    add(
      await tx
        .select({ id: people.id, userId: people.userId })
        .from(people)
        .where(and(baseActive, inArray(people.crewId, crewIds))),
    )
  }
  if (personGroupIds.length > 0) {
    add(
      await tx
        .select({ id: people.id, userId: people.userId })
        .from(people)
        .innerJoin(personGroupMemberships, eq(personGroupMemberships.personId, people.id))
        .where(and(baseActive, inArray(personGroupMemberships.groupId, personGroupIds))),
    )
  }
  if (roleKeys.length > 0) {
    // role.key → roleAssignments → tenantUsers(active) → people.userId
    add(
      await tx
        .select({ id: people.id, userId: people.userId })
        .from(people)
        .innerJoin(tenantUsers, eq(tenantUsers.userId, people.userId))
        .innerJoin(roleAssignments, eq(roleAssignments.tenantUserId, tenantUsers.id))
        .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
        .where(and(baseActive, eq(tenantUsers.status, 'active'), inArray(roles.key, roleKeys))),
    )
  }

  return toList(byId)
}

function toList(byId: Map<string, string | null>): ResolvedMember[] {
  return Array.from(byId.entries()).map(([personId, userId]) => ({ personId, userId }))
}

/**
 * Notification-friendly alias for the canonical resolver. The SAME engine drives
 * compliance obligation audiences AND reusable notification groups — both are
 * just a list of {kind, entityKey} audience items.
 */
export const resolveAudienceMembers = resolveObligationAudience
