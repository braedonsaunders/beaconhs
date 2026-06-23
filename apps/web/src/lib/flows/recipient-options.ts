import 'server-only'

// Active people / roles / departments for the send_email recipient pickers in
// the Flows canvas (person, department-managers, role targets). RLS-bound.

import { asc, isNull } from 'drizzle-orm'
import { departments, people, roles } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

export type RecipientOptionsData = {
  people: { id: string; name: string }[]
  roles: { key: string; name: string }[]
  departments: { id: string; name: string }[]
}

export async function loadRecipientOptions(ctx: RequestContext): Promise<RecipientOptionsData> {
  return ctx.db(async (tx) => {
    const ppl = await tx
      .select({ id: people.id, first: people.firstName, last: people.lastName })
      .from(people)
      .where(isNull(people.deletedAt))
      .orderBy(asc(people.lastName), asc(people.firstName))
    const rls = await tx
      .select({ key: roles.key, name: roles.name })
      .from(roles)
      .orderBy(asc(roles.name))
    const depts = await tx
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .orderBy(asc(departments.name))
    return {
      people: ppl.map((p) => ({ id: p.id, name: `${p.first} ${p.last}`.trim() })),
      roles: rls,
      departments: depts,
    }
  })
}
