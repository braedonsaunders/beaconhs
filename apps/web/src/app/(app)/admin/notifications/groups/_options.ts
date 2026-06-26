import 'server-only'

// Option lists for the notification-group member builder — one entry per
// grouping primitive a group can target (person / role / department / site /
// trade / crew / person-group). RLS-bound to the caller's tenant.

import { asc, eq, isNull } from 'drizzle-orm'
import {
  crews,
  departments,
  orgUnits,
  people,
  personGroups,
  roles,
  trades,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

export type AudienceOptions = {
  people: { id: string; name: string }[]
  roles: { key: string; name: string }[]
  departments: { id: string; name: string }[]
  orgUnits: { id: string; name: string }[]
  trades: { id: string; name: string }[]
  crews: { id: string; name: string }[]
  personGroups: { id: string; name: string }[]
}

export async function loadAudienceOptions(ctx: RequestContext): Promise<AudienceOptions> {
  return ctx.db(async (tx) => {
    const [ppl, rls, depts, units, trd, crw, pgroups] = await Promise.all([
      tx
        .select({ id: people.id, first: people.firstName, last: people.lastName })
        .from(people)
        .where(eq(people.status, 'active'))
        .orderBy(asc(people.lastName), asc(people.firstName))
        .limit(2000),
      tx.select({ key: roles.key, name: roles.name }).from(roles).orderBy(asc(roles.name)),
      tx
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .orderBy(asc(departments.name)),
      tx
        .select({ id: orgUnits.id, name: orgUnits.name, level: orgUnits.level })
        .from(orgUnits)
        .orderBy(asc(orgUnits.name)),
      tx.select({ id: trades.id, name: trades.name }).from(trades).orderBy(asc(trades.name)),
      tx.select({ id: crews.id, name: crews.name }).from(crews).orderBy(asc(crews.name)),
      tx
        .select({ id: personGroups.id, name: personGroups.name })
        .from(personGroups)
        .where(isNull(personGroups.deletedAt))
        .orderBy(asc(personGroups.name)),
    ])
    return {
      people: ppl.map((p) => ({ id: p.id, name: `${p.first} ${p.last}`.trim() })),
      roles: rls,
      departments: depts,
      orgUnits: units.map((u) => ({ id: u.id, name: `${u.name} · ${u.level}` })),
      trades: trd,
      crews: crw,
      personGroups: pgroups,
    }
  })
}
