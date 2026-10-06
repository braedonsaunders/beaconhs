import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import { people, tenantUsers } from './schema'
import { activePeopleWhere, activeTenantUsersWhere } from './people-selection'

const db = drizzle.mock()

describe('new person selection policy', () => {
  it('requires both active status and an undeleted person', () => {
    const query = db.select({ id: people.id }).from(people).where(activePeopleWhere()).toSQL()
    expect(query.sql).toContain('"people"."status" =')
    expect(query.sql).toContain('"people"."deleted_at" is null')
    expect(query.params).toEqual(['active'])
  })

  it('requires a live membership and scopes employee eligibility to its tenant and account', () => {
    const query = db
      .select({ id: tenantUsers.id })
      .from(tenantUsers)
      .where(activeTenantUsersWhere())
      .toSQL()
    expect(query.sql).toContain('"tenant_users"."status" =')
    expect(query.sql).toContain('"tenant_users"."removed_at" is null')
    expect(query.sql.match(/linked_person.tenant_id = "tenant_users"."tenant_id"/g)).toHaveLength(2)
    expect(query.sql.match(/linked_person.user_id = "tenant_users"."user_id"/g)).toHaveLength(2)
    expect(query.sql).toContain('not exists')
    expect(query.sql).toContain('or exists')
    expect(query.sql).toContain('linked_person.deleted_at is null')
    expect(query.sql).toContain('linked_person.status =')
    expect(query.params).toEqual(['active', 'active'])
  })
})
