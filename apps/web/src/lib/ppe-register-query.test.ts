import { readFileSync } from 'node:fs'
import { PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { ppeRegisterQuery } from './ppe-register-query'

const dialect = new PgDialect()
const person = '10000000-0000-4000-8000-000000000001'
const type = '10000000-0000-4000-8000-000000000002'
const compile = (sp: Record<string, string>) =>
  dialect.sqlToQuery(ppeRegisterQuery(sp, '2026-10-06').where!)

describe('PPE register and CSV query parity', () => {
  it('uses the same complete query on both surfaces', () => {
    for (const path of ['../app/(app)/ppe/page.tsx', '../app/(app)/ppe/export.csv/route.ts']) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8')
      expect(source).toContain('ppeRegisterQuery(sp)')
      expect(source).toContain('.where(whereClause)')
      expect(source).toContain('.orderBy(...orderBy)')
    }
  })

  it('keeps soft-deletion and status filtering around searches for hidden notes and holder names', () => {
    const query = compile({ q: 'Ryan Stirtzinger' })
    expect(query.sql).toContain('"ppe_items"."deleted_at" is null and')
    expect(query.sql).toContain('"ppe_items"."notes" ilike')
    expect(query.sql).toContain('"people"."first_name" ||')
    expect(query.sql).toContain('"people"."tenant_id" = "ppe_items"."tenant_id"')
    expect(query.sql).toContain('"ppe_types"."tenant_id" = "ppe_items"."tenant_id"')
    expect(query.params).toContain('%Ryan Stirtzinger%')
    for (const status of ['in_stock', 'issued', 'returned', 'out_of_service']) {
      expect(query.params).toContain(status)
    }
    expect(compile({ status: 'all' }).sql).not.toContain('"status"')
    expect(compile({ status: 'invalid-status' }).sql).not.toContain('"status"')
  })

  it('includes type and current or historical holder filters in exported searches', () => {
    const query = compile({ type, holder: person, q: 'harness', status: 'discarded' })
    expect(query.sql).toContain('"ppe_items"."type_id" =')
    expect(query.sql).toContain('"ppe_items"."current_holder_person_id" =')
    expect(query.sql).toContain('from "ppe_issues" pi')
    expect(query.sql).toContain('pi.tenant_id = "ppe_items"."tenant_id"')
    expect(query.params).toContain(type)
    expect(query.params.filter((value) => value === person)).toHaveLength(2)
    expect(query.params).toContain('discarded')
  })

  it('applies both inspection kinds to the exact same calendar windows in lists and exports', () => {
    const due = compile({ inspection: 'due_soon' })
    expect(due.sql).toContain("c.inspection_kind = 'pre_use'")
    expect(due.sql).toContain("c.inspection_kind = 'annual'")
    expect(due.params).toContain('2026-10-06')
    expect(due.params).toContain('2026-10-13')
    expect(due.sql).toContain('"ppe_items"."next_annual_inspection_due"')
    expect(compile({ inspection: 'needs_inspection' }).sql).toContain(
      '"next_inspection_due" is null',
    )
    expect(compile({ inspection: 'current' }).sql).toContain('least(')
    expect(compile({ inspection: 'not_required' }).sql).toContain('not')
  })

  it('preserves the register sort and adds a stable tie breaker to CSV ordering', () => {
    const query = ppeRegisterQuery({ sort: 'assigned', dir: 'desc' }, '2026-10-06')
    expect(dialect.sqlToQuery(query.orderBy[0]!).sql).toContain('desc nulls last')
    expect(dialect.sqlToQuery(query.orderBy.at(-1)!).sql).toBe('"ppe_items"."id" asc')
    expect(ppeRegisterQuery({}).params.sort).toBe('status_changed')
  })
})
