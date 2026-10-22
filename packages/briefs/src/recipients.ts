// Who receives a brief: tenant members, People groups, and plain addresses,
// resolved against CURRENT active memberships at send time and de-duplicated
// by email. Department is carried for split ("one brief per department")
// schedules.

import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { people, tenantUsers, users } from '@beaconhs/db/schema'
import { resolveGroupMembers } from '@beaconhs/events'
import type { BriefRunDelivery } from '@beaconhs/db/schema'

export type BriefRecipient = {
  email: string
  /** Better-Auth user id when the recipient has an account (in-app notice). */
  userId: string | null
  personId: string | null
  departmentId: string | null
}

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase()
  if (!email || email.length > 254 || /\s/.test(email)) return null
  const at = email.indexOf('@')
  if (at <= 0 || at !== email.lastIndexOf('@')) return null
  const domain = email.slice(at + 1),
    dot = domain.lastIndexOf('.')
  return dot > 0 && dot < domain.length - 1 ? email : null
}

export async function resolveBriefRecipients(
  tx: Database,
  tenantId: string,
  delivery: Pick<BriefRunDelivery, 'userIds' | 'groupIds' | 'emails'>,
): Promise<BriefRecipient[]> {
  const byEmail = new Map<string, BriefRecipient>()
  const add = (recipient: BriefRecipient) => {
    const email = normalizeEmail(recipient.email)
    if (!email) return
    const existing = byEmail.get(email)
    byEmail.set(email, {
      email,
      userId: existing?.userId ?? recipient.userId,
      personId: existing?.personId ?? recipient.personId,
      departmentId: existing?.departmentId ?? recipient.departmentId,
    })
  }

  if (delivery.userIds.length > 0) {
    const rows = await tx
      .select({
        userId: users.id,
        email: users.email,
        personId: people.id,
        departmentId: people.departmentId,
      })
      .from(tenantUsers)
      .innerJoin(users, eq(users.id, tenantUsers.userId))
      .leftJoin(
        people,
        and(
          eq(people.userId, tenantUsers.userId),
          eq(people.tenantId, tenantUsers.tenantId),
          isNull(people.deletedAt),
        ),
      )
      .where(
        and(
          eq(tenantUsers.tenantId, tenantId),
          eq(tenantUsers.status, 'active'),
          inArray(users.id, delivery.userIds),
        ),
      )
    for (const row of rows) add(row)
  }

  if (delivery.groupIds.length > 0) {
    const members = await resolveGroupMembers(tx, tenantId, delivery.groupIds)
    const personIds = members.map((m) => m.personId)
    if (personIds.length > 0) {
      const rows = await tx
        .select({
          personId: people.id,
          personEmail: people.email,
          departmentId: people.departmentId,
          userId: users.id,
          userEmail: users.email,
        })
        .from(people)
        .leftJoin(users, eq(users.id, people.userId))
        .where(and(eq(people.tenantId, tenantId), inArray(people.id, personIds)))
      for (const row of rows) {
        const email = row.personEmail || row.userEmail
        if (email) {
          add({
            email,
            userId: row.userId ?? null,
            personId: row.personId,
            departmentId: row.departmentId,
          })
        }
      }
    }
  }

  for (const email of delivery.emails) {
    add({ email, userId: null, personId: null, departmentId: null })
  }
  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email))
}
