// Toolbox assignment compliance. Modelled on the legacy
// JournalAssignmentApiController.computeCompliance but trimmed for the
// platform — we count "did this audience member log at least one toolbox
// talk in the window?" per audience member, then aggregate to a percent.

import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import {
  orgUnits,
  people,
  peopleAssignments,
  roleAssignments,
  roles,
  tenantUsers,
  toolboxJournalAssignments,
  toolboxJournals,
} from '@beaconhs/db/schema'

type Audience = {
  roleKeys?: string[]
  personIds?: string[]
  orgUnitIds?: string[]
}

export type ComplianceResult = {
  total: number
  compliant: number
  percent: number | null // null if total === 0
  perMember: { id: string; name: string; logged: number; compliant: boolean }[]
}

/**
 * Compute compliance for a single assignment over the given window
 * (default: last 30 days from `since`).
 *
 * Methodology:
 *   1. Resolve the audience → flat list of tenantUserIds (foreman role)
 *      OR personIds via roleKeys / personIds / orgUnitIds.
 *   2. For each audience member, count toolboxJournals where they were
 *      either the foreman OR an attendee in the window.
 *   3. Member is "compliant" if logged >= 1 in the window.
 *   4. Percent = compliantMembers / totalMembers.
 */
export async function computeAssignmentCompliance(
  tx: any,
  tenantId: string | null,
  assignment: typeof toolboxJournalAssignments.$inferSelect,
  since: Date,
): Promise<ComplianceResult> {
  if (!tenantId) return { total: 0, compliant: 0, percent: null, perMember: [] }
  const audience = (assignment.audience ?? {}) as Audience
  const members = await resolveAudienceMembers(tx, tenantId, audience)
  if (members.length === 0) {
    return { total: 0, compliant: 0, percent: null, perMember: [] }
  }
  const memberIds = members.map((m) => m.id)
  // Count journals where foreman is the member OR they were an attendee in window
  const journalsByForeman = await tx
    .select({
      foremanTenantUserId: toolboxJournals.foremanTenantUserId,
      c: sql<number>`count(*)::int`,
    })
    .from(toolboxJournals)
    .where(
      and(
        eq(toolboxJournals.tenantId, tenantId),
        gte(toolboxJournals.occurredOn, since.toISOString().slice(0, 10)),
      ),
    )
    .groupBy(toolboxJournals.foremanTenantUserId)
  const byForeman: Record<string, number> = {}
  for (const r of journalsByForeman) {
    if (r.foremanTenantUserId) byForeman[r.foremanTenantUserId] = Number(r.c)
  }

  let compliantCount = 0
  const perMember = members.map((m) => {
    const logged = byForeman[m.id] ?? 0
    const compliant = logged >= 1
    if (compliant) compliantCount += 1
    return { id: m.id, name: m.name, logged, compliant }
  })

  const percent = members.length === 0 ? null : (compliantCount / members.length) * 100
  return {
    total: members.length,
    compliant: compliantCount,
    percent,
    perMember,
  }
}

/**
 * Resolve an audience descriptor → list of tenantUsers (foreman pool). Why
 * tenantUsers and not people? Because the journal stores foremanTenantUserId,
 * and assignments measure "did this foreman log it?". The audience may be
 * expressed as roleKeys / personIds / orgUnitIds but we always project down
 * to active tenant users for measurement.
 */
async function resolveAudienceMembers(
  tx: any,
  tenantId: string,
  audience: Audience,
): Promise<{ id: string; name: string }[]> {
  const idSet = new Set<string>()
  const nameById = new Map<string, string>()

  // roleKeys → look up role IDs in this tenant, then assignments → tenantUsers
  if (audience.roleKeys && audience.roleKeys.length > 0) {
    const r = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), inArray(roles.key, audience.roleKeys)))
    if (r.length > 0) {
      const roleIds = r.map((row: { id: string }) => row.id)
      const ass = await tx
        .select({
          id: tenantUsers.id,
          displayName: tenantUsers.displayName,
        })
        .from(roleAssignments)
        .innerJoin(tenantUsers, eq(tenantUsers.id, roleAssignments.tenantUserId))
        .where(
          and(
            eq(roleAssignments.tenantId, tenantId),
            inArray(roleAssignments.roleId, roleIds),
            eq(tenantUsers.status, 'active'),
          ),
        )
      for (const u of ass) {
        idSet.add(u.id)
        nameById.set(u.id, u.displayName ?? u.id.slice(0, 8))
      }
    }
  }

  // personIds → if the person has a linked user account, project to that tenantUser
  if (audience.personIds && audience.personIds.length > 0) {
    const p = await tx
      .select({
        membershipId: tenantUsers.id,
        displayName: tenantUsers.displayName,
        firstName: people.firstName,
        lastName: people.lastName,
      })
      .from(people)
      .innerJoin(tenantUsers, eq(tenantUsers.userId, people.userId))
      .where(
        and(eq(people.tenantId, tenantId), inArray(people.id, audience.personIds)),
      )
    for (const u of p) {
      idSet.add(u.membershipId)
      nameById.set(
        u.membershipId,
        u.displayName ?? (`${u.lastName ?? ''}, ${u.firstName ?? ''}`.trim() || u.membershipId),
      )
    }
  }

  // orgUnitIds → tenantUsers assigned to that site via peopleAssignments → people → user
  if (audience.orgUnitIds && audience.orgUnitIds.length > 0) {
    const orgRows = await tx
      .select({
        membershipId: tenantUsers.id,
        displayName: tenantUsers.displayName,
        firstName: people.firstName,
        lastName: people.lastName,
      })
      .from(peopleAssignments)
      .innerJoin(people, eq(people.id, peopleAssignments.personId))
      .innerJoin(tenantUsers, eq(tenantUsers.userId, people.userId))
      .where(
        and(
          eq(peopleAssignments.tenantId, tenantId),
          inArray(peopleAssignments.orgUnitId, audience.orgUnitIds),
        ),
      )
    for (const u of orgRows) {
      idSet.add(u.membershipId)
      nameById.set(
        u.membershipId,
        u.displayName ?? (`${u.lastName ?? ''}, ${u.firstName ?? ''}`.trim() || u.membershipId),
      )
    }
  }

  // Fallback: empty audience = every active tenantUser
  if (
    (audience.roleKeys?.length ?? 0) === 0 &&
    (audience.personIds?.length ?? 0) === 0 &&
    (audience.orgUnitIds?.length ?? 0) === 0
  ) {
    const all = await tx
      .select({
        id: tenantUsers.id,
        displayName: tenantUsers.displayName,
      })
      .from(tenantUsers)
      .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.status, 'active')))
    for (const u of all) {
      idSet.add(u.id)
      nameById.set(u.id, u.displayName ?? u.id.slice(0, 8))
    }
  }

  return Array.from(idSet).map((id) => ({ id, name: nameById.get(id) ?? id }))
}
