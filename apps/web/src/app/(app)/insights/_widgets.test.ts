import { describe, expect, it } from 'vitest'
import { parseBhqlQuery } from '@beaconhs/analytics'
import {
  addTrustedSystemFormEntity,
  compileBhql,
  discoverEntityMap,
} from '@beaconhs/analytics/server'
import { BUILTIN_QUERIES } from './_widgets'

describe('built-in Insights queries', () => {
  const entityMap = addTrustedSystemFormEntity(discoverEntityMap())

  for (const [key, definition] of Object.entries(BUILTIN_QUERIES)) {
    it(`validates and compiles ${key}`, () => {
      const query = parseBhqlQuery(definition.query, entityMap)
      const compiled = compileBhql(query, { entityMap })

      expect(compiled.columns.length).toBeGreaterThan(0)
    })
  }
})
