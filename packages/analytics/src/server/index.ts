// @beaconhs/analytics/server — SERVER-ONLY entrypoint.
//
// Importing this pulls drizzle + the database engine, so it must only ever be
// imported from server code ('use server' actions, route handlers, the worker).
// Client code uses the pure root export instead.

import { parseBhqlQuery } from '../ast-schema'
import { discoverEntityMap } from './discover'

export { runBhql } from './execute'
export { compileBhql, type CompiledBhql } from './compile'
export { discoverEntities, discoverEntityMap, scopedFormAppEntity } from './discover'

/** Validate untrusted BHQL against the live, schema-discovered registry. The
 *  server-side convenience over the pure `parseBhqlQuery(raw, entityMap)`. */
export function validateBhql(raw: unknown) {
  return parseBhqlQuery(raw, discoverEntityMap())
}
