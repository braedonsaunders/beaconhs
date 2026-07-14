import 'server-only'

// Immediate label hydration for existing notification-group members. Searchable
// candidate catalogues are loaded through the purpose-scoped picker API; this
// loader deliberately queries only keys already persisted on the page.

import { inArray } from 'drizzle-orm'
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
import { isUuid } from '@/lib/list-params'

export type AudienceOptions = {
  people: { id: string; name: string }[]
  roles: { key: string; name: string }[]
  departments: { id: string; name: string }[]
  orgUnits: { id: string; name: string }[]
  trades: { id: string; name: string }[]
  crews: { id: string; name: string }[]
  personGroups: { id: string; name: string }[]
}

type AudienceReference = { kind: string; entityKey: string }

function keysFor(references: readonly AudienceReference[], kind: string): string[] {
  return [
    ...new Set(
      references
        .filter((reference) => reference.kind === kind)
        .map((reference) => reference.entityKey.trim())
        .filter(Boolean),
    ),
  ]
}

export async function loadAudienceOptions(
  ctx: RequestContext,
  references: readonly AudienceReference[],
): Promise<AudienceOptions> {
  const personIds = keysFor(references, 'person').filter(isUuid)
  const roleKeys = keysFor(references, 'role')
  const departmentIds = keysFor(references, 'department').filter(isUuid)
  const orgUnitIds = keysFor(references, 'org_unit').filter(isUuid)
  const tradeIds = keysFor(references, 'trade').filter(isUuid)
  const crewIds = keysFor(references, 'crew').filter(isUuid)
  const personGroupIds = keysFor(references, 'person_group').filter(isUuid)

  return ctx.db(async (tx) => {
    const [ppl, rls, depts, units, trd, crw, pgroups] = await Promise.all([
      personIds.length > 0
        ? tx
            .select({ id: people.id, first: people.firstName, last: people.lastName })
            .from(people)
            .where(inArray(people.id, personIds))
        : Promise.resolve([]),
      roleKeys.length > 0
        ? tx
            .select({ key: roles.key, name: roles.name })
            .from(roles)
            .where(inArray(roles.key, roleKeys))
        : Promise.resolve([]),
      departmentIds.length > 0
        ? tx
            .select({ id: departments.id, name: departments.name })
            .from(departments)
            .where(inArray(departments.id, departmentIds))
        : Promise.resolve([]),
      orgUnitIds.length > 0
        ? tx
            .select({ id: orgUnits.id, name: orgUnits.name, level: orgUnits.level })
            .from(orgUnits)
            .where(inArray(orgUnits.id, orgUnitIds))
        : Promise.resolve([]),
      tradeIds.length > 0
        ? tx
            .select({ id: trades.id, name: trades.name })
            .from(trades)
            .where(inArray(trades.id, tradeIds))
        : Promise.resolve([]),
      crewIds.length > 0
        ? tx
            .select({ id: crews.id, name: crews.name })
            .from(crews)
            .where(inArray(crews.id, crewIds))
        : Promise.resolve([]),
      personGroupIds.length > 0
        ? tx
            .select({ id: personGroups.id, name: personGroups.name })
            .from(personGroups)
            .where(inArray(personGroups.id, personGroupIds))
        : Promise.resolve([]),
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
