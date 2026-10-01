import 'server-only'

// Active people / roles / departments for the send_email recipient pickers in
// the Flows canvas (person, department-managers, role targets). RLS-bound.

import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  attachments,
  complianceObligations,
  customerContacts,
  departments,
  orgUnits,
  people,
  personGroups,
  roles,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

import type { RecipientOptions } from './recipient-presentation'

export async function loadRecipientOptions(ctx: RequestContext): Promise<RecipientOptions> {
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
    const [pGroups, contacts, obligations, spreadsheetTemplates] = await Promise.all([
      tx
        .select({ id: personGroups.id, name: personGroups.name })
        .from(personGroups)
        .where(isNull(personGroups.deletedAt))
        .orderBy(asc(personGroups.name)),
      tx
        .select({
          id: customerContacts.id,
          name: customerContacts.name,
          email: customerContacts.email,
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
      tx
        .select({ id: attachments.id, name: attachments.filename })
        .from(attachments)
        .where(
          and(
            eq(attachments.kind, 'document'),
            eq(
              attachments.contentType,
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            ),
          ),
        )
        .orderBy(asc(attachments.filename)),
    ])
    return {
      people: ppl.map((p) => ({ id: p.id, name: `${p.first} ${p.last}`.trim() })),
      roles: rls,
      departments: depts,
      personGroups: pGroups,
      contacts,
      obligations,
      spreadsheetTemplates,
    }
  })
}
