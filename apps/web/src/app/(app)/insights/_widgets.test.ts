import { describe, expect, it } from 'vitest'
import { parseBhqlQuery } from '@beaconhs/analytics'
import {
  addTrustedSystemAppResponsesEntity,
  compileBhql,
  discoverEntityMap,
} from '@beaconhs/analytics/server'
import { BUILTIN_QUERIES } from './_widgets'

describe('built-in Insights queries', () => {
  const entityMap = addTrustedSystemAppResponsesEntity(discoverEntityMap())

  it('uses the managed app response source instead of raw Builder storage', () => {
    expect(entityMap.app_responses).toBeDefined()
    expect(entityMap.form_responses).toBeUndefined()
    expect(
      Object.values(BUILTIN_QUERIES).some(({ query }) =>
        query.stages.some(({ source }) => source === 'form_responses'),
      ),
    ).toBe(false)
  })

  for (const [key, definition] of Object.entries(BUILTIN_QUERIES)) {
    it(`validates and compiles ${key}`, () => {
      const query = parseBhqlQuery(definition.query, entityMap)
      const compiled = compileBhql(query, { entityMap })

      expect(compiled.columns.length).toBeGreaterThan(0)
    })
  }
})
