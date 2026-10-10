import { describe, expect, it } from 'vitest'
import { compileBhql, discoverEntityMap } from '@beaconhs/analytics/server'
import { PgDialect } from 'drizzle-orm/pg-core'
import { BUILTIN_QUERIES } from './_widgets'
import {
  applyMatrixFilterRules,
  parseMatrixFilters,
  serializeMatrixFilters,
} from './_matrix-filter-values'

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const query = BUILTIN_QUERIES['training-skills-matrix']!.query

describe('matrix runtime filters', () => {
  it('validates identifiers and preserves all selected categories in a bookmark', () => {
    const selected = parseMatrixFilters(
      JSON.stringify({ people: [first, first], groups: [second], statuses: ['expired'] }),
    )
    expect(selected.people).toEqual([first])
    expect(parseMatrixFilters(serializeMatrixFilters(selected))).toEqual(selected)
    expect(() => parseMatrixFilters('{"people":["bad"]}')).toThrow()
    expect(() => parseMatrixFilters('{"unknown":[]}')).toThrow()
  })

  it('narrows an existing OR query without changing the saved definition', () => {
    const original = structuredClone(query)
    original.stages[0]!.filter = {
      combinator: 'or',
      rules: [
        { field: 'coverage_status', op: 'eq', value: 'valid' },
        { field: 'coverage_status', op: 'eq', value: 'expired' },
      ],
    }
    const snapshot = structuredClone(original)
    const filtered = applyMatrixFilterRules(
      original,
      parseMatrixFilters(JSON.stringify({ people: [first], types: [second] })),
    )
    expect(filtered.stages[0]!.filter).toEqual({
      combinator: 'and',
      rules: [
        snapshot.stages[0]!.filter,
        { field: 'person_id', op: 'in', value: [first] },
        { field: 'skill_type_id', op: 'in', value: [second] },
      ],
    })
    expect(original).toEqual(snapshot)
  })

  it('matches any selected group inside multi-group membership using bound identifiers', () => {
    const filtered = applyMatrixFilterRules(
      query,
      parseMatrixFilters(JSON.stringify({ groups: [first, second] })),
    )
    const compiled = compileBhql(filtered, { entityMap: discoverEntityMap() })
    const sql = new PgDialect().sqlToQuery(compiled.sql)
    expect(sql.sql).toContain('string_to_array')
    expect(sql.sql).toContain('&& ARRAY[')
    expect(sql.params).toContain(first)
    expect(sql.params).toContain(second)
    expect(sql.sql).not.toContain(first)
  })
})
