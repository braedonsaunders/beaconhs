import { and, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  complianceAudience,
  complianceObligations,
  complianceStatus,
  people,
  peopleAssignments,
  roleAssignments,
  roles,
  tenantUsers,
} from '@beaconhs/db/schema'
import { materializeObligation, resolveComplianceClock } from './materialize'

export type IdentityAudienceMaterialization = {
  personIds: string[]
  obligationIds: string[]
}

/** Resolve tenant-local people linked to login identities, then run the same
 * canonical reconciliation used by direct person writers. Membership and RBAC
 * actions know user ids, while compliance is intentionally person-keyed. */
export async function materializeUserIdentityAudienceObligations(
  tx: Database,
  tenantId: string,
  rawUserIds: readonly string[],
): Promise<IdentityAudienceMaterialization> {
  const userIds = [...new Set(rawUserIds.map((id) => id.trim()).filter(Boolean))]
  if (userIds.length === 0) return { personIds: [], obligationIds: [] }
  const rows = await tx
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.tenantId, tenantId), inArray(people.userId, userIds)))
  return materializeIdentityAudienceObligations(
    tx,
    tenantId,
    rows.map((row) => row.id),
  )
}

/**
 * Reconcile the canonical compliance scoreboard after identity dimensions for
 * one or more people change.
 *
 * Selection deliberately has two halves:
 *  - current audience matches add obligations the people have just entered;
 *  - prior compliance_status rows add obligations the people have just left.
 *
 * The second half is essential. Looking only at the post-update department,
 * trade, role or membership would never revisit the old obligation, leaving a
 * stale status row indefinitely. Each selected obligation is fully evaluated,
 * so `materializeObligation` also removes every no-longer-applicable row.
 *
 * Call this inside the same transaction as the identity mutation. The person
 * rows and obligation order are deterministic to serialize overlapping admin
 * changes without introducing lock-order inversions.
 */
export async function materializeIdentityAudienceObligations(
  tx: Database,
  tenantId: string,
  rawPersonIds: readonly string[],
): Promise<IdentityAudienceMaterialization> {
  const personIds = [...new Set(rawPersonIds.map((id) => id.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )
  if (personIds.length === 0) return { personIds: [], obligationIds: [] }

  // FOR UPDATE makes this the serialization point shared by person, role,
  // membership and person↔login mutations. Include inactive/soft-deleted rows:
  // they still carry the old dimensions needed to find stale obligations.
  const currentPeople = await tx
    .select({
      id: people.id,
      userId: people.userId,
      departmentId: people.departmentId,
      tradeId: people.tradeId,
    })
    .from(people)
    .where(and(eq(people.tenantId, tenantId), inArray(people.id, personIds)))
    .orderBy(people.id)
    .for('update')

  const currentPersonIds = currentPeople.map((person) => person.id)
  const departmentIds = [
    ...new Set(currentPeople.map((person) => person.departmentId).filter((id) => id !== null)),
  ]
  const tradeIds = [
    ...new Set(currentPeople.map((person) => person.tradeId).filter((id) => id !== null)),
  ]
  const userIds = [
    ...new Set(currentPeople.map((person) => person.userId).filter((id) => id !== null)),
  ]

  let orgUnitIds: string[] = []
  if (currentPersonIds.length > 0) {
    const today = sql`current_date`
    const rows = await tx
      .selectDistinct({ id: peopleAssignments.orgUnitId })
      .from(peopleAssignments)
      .where(
        and(
          eq(peopleAssignments.tenantId, tenantId),
          inArray(peopleAssignments.personId, currentPersonIds),
          lte(peopleAssignments.validFrom, today),
          or(isNull(peopleAssignments.validTo), gte(peopleAssignments.validTo, today)),
        ),
      )
    orgUnitIds = rows.map((row) => row.id)
  }

  let roleKeys: string[] = []
  if (userIds.length > 0) {
    const rows = await tx
      .selectDistinct({ key: roles.key })
      .from(tenantUsers)
      .innerJoin(
        roleAssignments,
        and(
          eq(roleAssignments.tenantId, tenantUsers.tenantId),
          eq(roleAssignments.tenantUserId, tenantUsers.id),
        ),
      )
      .innerJoin(
        roles,
        and(eq(roles.tenantId, roleAssignments.tenantId), eq(roles.id, roleAssignments.roleId)),
      )
      .where(
        and(
          eq(tenantUsers.tenantId, tenantId),
          eq(tenantUsers.status, 'active'),
          inArray(tenantUsers.userId, userIds),
        ),
      )
    roleKeys = rows.map((row) => row.key)
  }

  const activeObligation = and(
    eq(complianceObligations.tenantId, tenantId),
    eq(complianceObligations.status, 'active'),
    isNull(complianceObligations.deletedAt),
  )
  const currentMatches: SQL[] = [
    eq(complianceAudience.kind, 'everyone'),
    and(eq(complianceAudience.kind, 'person'), inArray(complianceAudience.entityKey, personIds))!,
  ]
  if (departmentIds.length > 0) {
    currentMatches.push(
      and(
        eq(complianceAudience.kind, 'department'),
        inArray(complianceAudience.entityKey, departmentIds),
      )!,
    )
  }
  if (tradeIds.length > 0) {
    currentMatches.push(
      and(eq(complianceAudience.kind, 'trade'), inArray(complianceAudience.entityKey, tradeIds))!,
    )
  }
  if (orgUnitIds.length > 0) {
    currentMatches.push(
      and(
        eq(complianceAudience.kind, 'org_unit'),
        inArray(complianceAudience.entityKey, orgUnitIds),
      )!,
    )
  }
  if (roleKeys.length > 0) {
    currentMatches.push(
      and(eq(complianceAudience.kind, 'role'), inArray(complianceAudience.entityKey, roleKeys))!,
    )
  }

  const [currentRows, priorRows] = await Promise.all([
    tx
      .selectDistinct({ id: complianceObligations.id })
      .from(complianceObligations)
      .innerJoin(
        complianceAudience,
        and(
          eq(complianceAudience.tenantId, complianceObligations.tenantId),
          eq(complianceAudience.obligationId, complianceObligations.id),
        ),
      )
      .where(and(activeObligation, or(...currentMatches))),
    tx
      .selectDistinct({ id: complianceObligations.id })
      .from(complianceObligations)
      .innerJoin(
        complianceStatus,
        and(
          eq(complianceStatus.tenantId, complianceObligations.tenantId),
          eq(complianceStatus.obligationId, complianceObligations.id),
        ),
      )
      .innerJoin(
        complianceAudience,
        and(
          eq(complianceAudience.tenantId, complianceObligations.tenantId),
          eq(complianceAudience.obligationId, complianceObligations.id),
        ),
      )
      .where(
        and(
          activeObligation,
          eq(complianceStatus.tenantId, tenantId),
          inArray(complianceStatus.personId, personIds),
        ),
      ),
  ])

  const obligationIds = [...new Set([...currentRows, ...priorRows].map((row) => row.id))].sort(
    (a, b) => a.localeCompare(b),
  )
  if (obligationIds.length === 0) return { personIds, obligationIds: [] }

  const obligations = await tx
    .select()
    .from(complianceObligations)
    .where(and(activeObligation, inArray(complianceObligations.id, obligationIds)))
    .orderBy(complianceObligations.id)
  const clock = await resolveComplianceClock(tx, tenantId)
  for (const obligation of obligations) {
    await materializeObligation(tx, tenantId, obligation, clock)
  }

  return { personIds, obligationIds: obligations.map((obligation) => obligation.id) }
}
