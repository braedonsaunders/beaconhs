import 'server-only'

// Active people / roles / departments for the send_email recipient pickers in
// the Flows canvas (person, department-managers, role targets). RLS-bound.

import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  complianceObligations,
  customerContacts,
  departments,
  notificationGroups,
  orgUnits,
  people,
  personGroups,
  roles,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

type RecipientOptionsData = {
  people: { id: string; name: string }[]
  roles: { key: string; name: string }[]
  departments: { id: string; name: string }[]
  groups: { id: string; name: string }[]
  personGroups: { id: string; name: string }[]
  contacts: { id: string; name: string; orgUnitName: string }[]
  obligations: { id: string; name: string }[]
}

export async function loadRecipientOptions(ctx: RequestContext): Promise<RecipientOptionsData> {
  return ctx.db(async (tx) => {
    const ppl = await tx
      .select({ id: people.id, first: people.firstName, last: people.lastName })
      .from(people)
      .where(and(isNull(people.deletedAt), eq(people.status, 'active')))
      .orderBy(asc(people.lastName), asc(people.firstName))
    const rls = await tx
      .select({ key: roles.key, name: roles.name })
      .from(roles)
      .orderBy(asc(roles.name))
    const depts = await tx
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .orderBy(asc(departments.name))
    // Reusable notification groups — degrade to empty if the table isn't there.
    let groups: { id: string; name: string }[] = []
    try {
      groups = await tx
        .select({ id: notificationGroups.id, name: notificationGroups.name })
        .from(notificationGroups)
        .where(isNull(notificationGroups.deletedAt))
        .orderBy(asc(notificationGroups.name))
    } catch {
      groups = []
    }
    const [pGroups, contacts, obligations] = await Promise.all([
      tx
        .select({ id: personGroups.id, name: personGroups.name })
        .from(personGroups)
        .where(isNull(personGroups.deletedAt))
        .orderBy(asc(personGroups.name)),
      tx
        .select({
          id: customerContacts.id,
          name: customerContacts.name,
          orgUnitName: orgUnits.name,
        })
        .from(customerContacts)
        .innerJoin(orgUnits, eq(orgUnits.id, customerContacts.orgUnitId))
        .orderBy(asc(orgUnits.name), asc(customerContacts.name)),
      tx
        .select({ id: complianceObligations.id, name: complianceObligations.title })
        .from(complianceObligations)
        .where(
          and(eq(complianceObligations.status, 'active'), isNull(complianceObligations.deletedAt)),
        )
        .orderBy(asc(complianceObligations.title)),
    ])
    return {
      people: ppl.map((p) => ({ id: p.id, name: `${p.first} ${p.last}`.trim() })),
      roles: rls,
      departments: depts,
      groups,
      personGroups: pGroups,
      contacts,
      obligations,
    }
  })
}
