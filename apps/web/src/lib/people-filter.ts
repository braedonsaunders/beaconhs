import { activeTenantUsersWhere } from '@beaconhs/db'
import { and, eq, isNull, or } from 'drizzle-orm'
import { people, tenantUsers } from '@beaconhs/db/schema'
import { pickString } from './list-params'

/** Historical list filters default to active people; record visibility is unchanged. */
export function includeInactivePeople(
  params: Record<string, string | string[] | undefined>,
): boolean {
  return pickString(params.peopleStatus) === 'all'
}

/** Preserve selected historical links without exposing inactive people as new choices. */
export function personFilterWhere(includeInactive: boolean, selected?: string | null) {
  return and(
    isNull(people.deletedAt),
    includeInactive
      ? undefined
      : or(eq(people.status, 'active'), selected ? eq(people.id, selected) : undefined),
  )
}

export function tenantUserFilterWhere(includeInactive: boolean, selected?: string | null) {
  return includeInactive
    ? undefined
    : or(activeTenantUsersWhere(), selected ? eq(tenantUsers.id, selected) : undefined)
}
