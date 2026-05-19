// Shared helper that resolves an assignment's audience into a flat list of
// people. Used by both the assignment detail page (to show the per-person
// compliance table) and the list page (to compute the rolled-up percentage).
//
// Audience rows can target:
//   - `role`        — entityKey = role key (e.g. 'worker'); resolves via
//                     role_assignments → tenant_users → users → people-by-userId.
//   - `trade`       — entityKey = trade uuid; resolves people.trade_id = X.
//   - `department`  — entityKey = department uuid; resolves people.department_id = X.
//   - `person`      — entityKey = person uuid; one row.
//   - `everyone`    — all active people in the tenant.
//
// Compliance:
//   resolved people INNER JOIN document_acknowledgments WHERE document_id = D
//   AND person_id IN (...)
//   percent = ack'd / resolved (0 if no resolved people).

import { and, eq, inArray, sql } from 'drizzle-orm'
import type { RequestContext } from '@beaconhs/tenant'
import {
  documentAcknowledgments,
  documentAssignmentAudience,
  documentAssignments,
  people,
  roleAssignments,
  roles,
  tenantUsers,
} from '@beaconhs/db/schema'

export type AudienceRow = {
  type: 'role' | 'trade' | 'department' | 'person' | 'everyone'
  entityKey: string
}

export type ResolvedPerson = {
  id: string
  firstName: string
  lastName: string
  email: string | null
  jobTitle: string | null
}

export async function resolveAudience(
  ctx: RequestContext,
  audience: AudienceRow[],
): Promise<ResolvedPerson[]> {
  if (audience.length === 0) return []

  return ctx.db(async (tx) => {
    const ids = new Set<string>()
    const byId = new Map<string, ResolvedPerson>()

    const pushPeople = (rows: ResolvedPerson[]): void => {
      for (const p of rows) {
        if (ids.has(p.id)) continue
        ids.add(p.id)
        byId.set(p.id, p)
      }
    }

    const fetchByIds = async (peopleIds: string[]): Promise<ResolvedPerson[]> => {
      if (peopleIds.length === 0) return []
      const rows = await tx
        .select({
          id: people.id,
          firstName: people.firstName,
          lastName: people.lastName,
          email: people.email,
          jobTitle: people.jobTitle,
        })
        .from(people)
        .where(
          and(eq(people.status, 'active'), inArray(people.id, peopleIds), sql`${people.deletedAt} is null`),
        )
      return rows
    }

    for (const a of audience) {
      if (a.type === 'everyone') {
        const all = await tx
          .select({
            id: people.id,
            firstName: people.firstName,
            lastName: people.lastName,
            email: people.email,
            jobTitle: people.jobTitle,
          })
          .from(people)
          .where(and(eq(people.status, 'active'), sql`${people.deletedAt} is null`))
        pushPeople(all)
      } else if (a.type === 'person') {
        const rows = await fetchByIds([a.entityKey])
        pushPeople(rows)
      } else if (a.type === 'trade') {
        const rows = await tx
          .select({
            id: people.id,
            firstName: people.firstName,
            lastName: people.lastName,
            email: people.email,
            jobTitle: people.jobTitle,
          })
          .from(people)
          .where(
            and(
              eq(people.status, 'active'),
              eq(people.tradeId, a.entityKey),
              sql`${people.deletedAt} is null`,
            ),
          )
        pushPeople(rows)
      } else if (a.type === 'department') {
        const rows = await tx
          .select({
            id: people.id,
            firstName: people.firstName,
            lastName: people.lastName,
            email: people.email,
            jobTitle: people.jobTitle,
          })
          .from(people)
          .where(
            and(
              eq(people.status, 'active'),
              eq(people.departmentId, a.entityKey),
              sql`${people.deletedAt} is null`,
            ),
          )
        pushPeople(rows)
      } else if (a.type === 'role') {
        // role -> role_assignments.tenantUserId -> tenant_users.userId -> people.userId
        const userIds = await tx
          .select({ userId: tenantUsers.userId })
          .from(roleAssignments)
          .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
          .innerJoin(tenantUsers, eq(tenantUsers.id, roleAssignments.tenantUserId))
          .where(eq(roles.key, a.entityKey))
        const userIdList = userIds.map((u) => u.userId).filter(Boolean) as string[]
        if (userIdList.length === 0) continue
        const rows = await tx
          .select({
            id: people.id,
            firstName: people.firstName,
            lastName: people.lastName,
            email: people.email,
            jobTitle: people.jobTitle,
          })
          .from(people)
          .where(
            and(
              eq(people.status, 'active'),
              inArray(people.userId, userIdList),
              sql`${people.deletedAt} is null`,
            ),
          )
        pushPeople(rows)
      }
    }

    return Array.from(byId.values()).sort((a, b) => {
      const aname = `${a.lastName} ${a.firstName}`.toLowerCase()
      const bname = `${b.lastName} ${b.firstName}`.toLowerCase()
      return aname < bname ? -1 : aname > bname ? 1 : 0
    })
  })
}

/**
 * Returns `{ resolved, acknowledged, percent }` for an assignment.
 * Acknowledgement = at least one `document_acknowledgments` row for this
 * person + document (any version). Matches the legacy 'completed = Yes' rule.
 */
export async function computeCompliance(
  ctx: RequestContext,
  assignmentId: string,
): Promise<{ resolved: ResolvedPerson[]; ackedIds: Set<string>; percent: number }> {
  const data = await ctx.db(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(documentAssignments)
      .where(eq(documentAssignments.id, assignmentId))
      .limit(1)
    if (!assignment) return null
    const audience = await tx
      .select({
        type: documentAssignmentAudience.type,
        entityKey: documentAssignmentAudience.entityKey,
      })
      .from(documentAssignmentAudience)
      .where(eq(documentAssignmentAudience.assignmentId, assignmentId))
    return { assignment, audience }
  })
  if (!data) return { resolved: [], ackedIds: new Set(), percent: 0 }

  const resolved = await resolveAudience(
    ctx,
    data.audience.map((a) => ({ type: a.type, entityKey: a.entityKey })),
  )
  if (resolved.length === 0) return { resolved: [], ackedIds: new Set(), percent: 0 }

  const ackedIds = await ctx.db(async (tx) => {
    const acks = await tx
      .select({ personId: documentAcknowledgments.personId })
      .from(documentAcknowledgments)
      .where(
        and(
          eq(documentAcknowledgments.documentId, data.assignment.documentId),
          inArray(
            documentAcknowledgments.personId,
            resolved.map((r) => r.id),
          ),
        ),
      )
    return new Set(acks.map((a) => a.personId))
  })

  const percent = resolved.length === 0 ? 0 : Math.round((ackedIds.size / resolved.length) * 100)
  return { resolved, ackedIds, percent }
}
