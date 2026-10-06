import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { people, tenantUsers } from './schema'

/** New assignments must never offer retired or soft-deleted people. */
export function activePeopleWhere(): SQL {
  return and(eq(people.status, 'active'), isNull(people.deletedAt))!
}

/** Active accounts without an employee link remain eligible (for example admins). */
export function activeTenantUsersWhere(): SQL {
  return and(
    eq(tenantUsers.status, 'active'),
    isNull(tenantUsers.removedAt),
    sql`(
      not exists (
        select 1 from ${people} linked_person
        where linked_person.tenant_id = ${tenantUsers.tenantId}
          and linked_person.user_id = ${tenantUsers.userId}
      ) or exists (
        select 1 from ${people} linked_person
        where linked_person.tenant_id = ${tenantUsers.tenantId}
          and linked_person.user_id = ${tenantUsers.userId}
          and linked_person.status = ${'active'}
          and linked_person.deleted_at is null
      )
    )`,
  )!
}
