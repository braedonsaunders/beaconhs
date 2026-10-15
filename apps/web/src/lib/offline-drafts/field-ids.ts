// Field ids for edits on a record's child rows: `<collection>:<rowId>:<field>`
// (e.g. `criteria:<uuid>:answer`, `ppe:<uuid>:answer`). The record page
// builds them when it binds an editor; the module's saver parses them back
// and resolves the row against the locked parent record. Pure — shared by the
// client editors and the server savers.

import { isUuid } from '@/lib/list-params'

export function rowFieldId(collection: string, rowId: string, field: string): string {
  return `${collection}:${rowId}:${field}`
}

/**
 * The collection, row, and field a child-row field id names, or null when it
 * is not one of the listed collections/fields or the row id is not a UUID.
 */
export function parseRowFieldId<const C extends string, const F extends string>(
  fieldId: string,
  collections: { readonly [K in C]: readonly F[] },
): { collection: C; rowId: string; field: F } | null {
  const parts = fieldId.split(':')
  if (parts.length !== 3) return null
  const [collection, rowId, field] = parts as [string, string, string]
  if (!Object.prototype.hasOwnProperty.call(collections, collection)) return null
  const fields: readonly string[] = collections[collection as C]
  if (!fields.includes(field) || !isUuid(rowId)) return null
  return { collection: collection as C, rowId, field: field as F }
}
