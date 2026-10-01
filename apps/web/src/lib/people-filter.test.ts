import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { people, tenantUsers } from '@beaconhs/db/schema'
import { includeInactivePeople, personFilterWhere, tenantUserFilterWhere } from './people-filter'

const selected = '10000000-0000-4000-8000-000000000001'
const db = drizzle.mock()

describe('historical people filter policy', () => {
  it('requires explicit opt-in; malformed states keep the active default', () => {
    expect(includeInactivePeople({})).toBe(false)
    expect(includeInactivePeople({ peopleStatus: 'inactive' })).toBe(false)
    expect(includeInactivePeople({ peopleStatus: 'all' })).toBe(true)
  })
  it('excludes deleted people in both modes and only permits the selected inactive exception', () => {
    const active = db.select().from(people).where(personFilterWhere(false)).toSQL()
    expect(active.sql).toContain('"people"."deleted_at" is null')
    expect(active.sql).toContain('"people"."status" =')
    expect(active.params).toEqual(['active'])
    const historical = db.select().from(people).where(personFilterWhere(true)).toSQL()
    expect(historical.sql).toContain('"people"."deleted_at" is null')
    expect(historical.sql).not.toContain('"people"."status" =')
    const hydrated = db.select().from(people).where(personFilterWhere(false, selected)).toSQL()
    expect(hydrated.sql).toContain(' or ')
    expect(hydrated.params).toEqual(['active', selected])
  })
  it('excludes suspended, invited and removed memberships by default', () => {
    const active = db.select().from(tenantUsers).where(tenantUserFilterWhere(false)).toSQL()
    expect(active.sql).toContain('"tenant_users"."removed_at" is null')
    expect(active.params).toEqual(['active', 'active'])
    expect(active.sql).toContain('p.user_id = "tenant_users"."user_id"')
    expect(active.sql).toContain('p.tenant_id = "tenant_users"."tenant_id"')
    expect(active.sql).toContain('p.status <>')
    const historical = db.select().from(tenantUsers).where(tenantUserFilterWhere(true)).toSQL()
    expect(historical.sql).not.toContain(' where ')
  })
})
