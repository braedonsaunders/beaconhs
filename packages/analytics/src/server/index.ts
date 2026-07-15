// @beaconhs/analytics/server — SERVER-ONLY entrypoint.
//
// Importing this pulls drizzle + the database engine, so it must only ever be
// imported from server code ('use server' actions, route handlers, the worker).
// Client code uses the pure root export instead.

import { parseBhqlQuery } from '../ast-schema'
import { addTrustedSystemFormEntity, discoverEntityMap } from './discover'

export { runBhql } from './execute'
export { compileBhql } from './compile'
export { addTrustedSystemFormEntity, discoverEntities, discoverEntityMap } from './discover'
export { discoverEntitiesWithScopedApps, discoverEntityMapWithScopedApps } from './custom-fields'

/** Validate untrusted BHQL against the live, schema-discovered registry. The
 *  server-side convenience over the pure `parseBhqlQuery(raw, entityMap)`. */
export function validateBhql(raw: unknown) {
  return parseBhqlQuery(raw, discoverEntityMap())
}

/** Validate a code-owned system card. This narrowly adds the tenant-wide form
 *  response source used by managed operational KPIs; never use it for
 *  tenant-authored cards. */
export function validateTrustedSystemBhql(raw: unknown) {
  return parseBhqlQuery(raw, addTrustedSystemFormEntity(discoverEntityMap()))
}
