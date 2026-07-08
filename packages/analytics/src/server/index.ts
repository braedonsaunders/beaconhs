// @beaconhs/analytics/server — SERVER-ONLY entrypoint.
//
// Importing this pulls drizzle + the database engine, so it must only ever be
// imported from server code ('use server' actions, route handlers, the worker).
// Client code uses the pure root export instead.

import type { Database } from '@beaconhs/db'
import { parseBhqlQuery } from '../ast-schema'
import { discoverEntityMap } from './discover'
import { discoverEntityMapWithCustomFields } from './custom-fields'

export { runBhql } from './execute'
export { compileBhql, type CompiledBhql } from './compile'
export { discoverEntities, discoverEntityMap, scopedFormAppEntity } from './discover'
export {
  discoverEntitiesWithApps,
  discoverEntitiesWithCustomFields,
  discoverEntityMapWithCustomFields,
} from './custom-fields'

/** Validate untrusted BHQL against the live, schema-discovered registry. The
 *  server-side convenience over the pure `parseBhqlQuery(raw, entityMap)`. */
export function validateBhql(raw: unknown) {
  return parseBhqlQuery(raw, discoverEntityMap())
}

/** Validate untrusted BHQL against the registry augmented with the tenant's
 *  custom-field columns — use at save time so cards that reference `cf_*`
 *  columns pass validation (mirrors what `runBhql` does at execution). */
export async function validateBhqlWithCustomFields(tx: Database, raw: unknown) {
  return parseBhqlQuery(raw, await discoverEntityMapWithCustomFields(tx))
}
