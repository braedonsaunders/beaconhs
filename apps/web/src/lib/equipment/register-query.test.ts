import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { equipmentRegisterQuery } from './register-query'

const dialect = new PgDialect()
const departmentId = '10000000-0000-4000-8000-000000000001'
function where(sp: Record<string, string>) {
  return dialect.sqlToQuery(equipmentRegisterQuery(sp).where!)
}

describe('equipment register and export query', () => {
  it('defaults to in service and clears the enum predicate for all statuses', () => {
    expect(where({}).params).toContain('in_service')
    expect(where({ status: 'all' }).sql).not.toContain('"status"')
    expect(where({ status: 'all' }).params).not.toContain('all')
    expect(where({ status: 'not-a-status' }).sql).toContain('false')
  })

  it('combines department, category, type, availability, search, and soft-delete filters', () => {
    const query = where({
      status: 'all',
      department: departmentId,
      category: departmentId,
      type: departmentId,
      availability: 'checked_out',
      q: 'Shop',
    })
    expect(query.sql).toContain('"equipment_items"."department_id"')
    expect(query.sql).toContain('"equipment_items"."category_id"')
    expect(query.sql).toContain('"equipment_items"."type_id"')
    expect(query.sql).toContain('"equipment_items"."deleted_at" is null')
    expect(query.sql).toContain('"departments"."name" ilike')
    expect(query.params).toContain(false)
    expect(query.params).toContain('%Shop%')
    expect(query.params.filter((p) => p === departmentId)).toHaveLength(3)
  })

  it('filters the current holder consistently for the register and its export', () => {
    const query = where({ holder: departmentId, department: departmentId, status: 'all' })
    expect(query.sql).toContain('"equipment_items"."current_holder_person_id" =')
    expect(query.params.filter((value) => value === departmentId)).toHaveLength(2)
    expect(where({ holder: 'not-a-person-id' }).sql).toContain('false')
  })

  it('fails closed on malformed reference filters and supports stable department sorting', () => {
    expect(where({ department: 'bad-id' }).sql).toContain('false')
    const query = equipmentRegisterQuery({ sort: 'department', dir: 'desc' })
    expect(dialect.sqlToQuery(query.orderBy[0]!).sql).toBe('"departments"."name" desc')
    expect(dialect.sqlToQuery(query.orderBy[1]!).sql).toBe('"equipment_items"."id" asc')
  })
})
