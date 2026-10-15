// The one order a person's group and title chips are shown and compared in:
// by catalogue name, then id. The record page renders the inline Groups /
// Titles fields in this order and the people record saver formats the stored
// sets the same way, so the device's "last seen" value always compares equal
// to the server's when nothing changed. Pure — no database imports.

import { isUuid } from '@/lib/list-params'

/** Ids ordered by their catalogue name (unknown ids last, by id). */
export function orderIdsByName(
  ids: readonly string[],
  names: ReadonlyMap<string, string>,
): string[] {
  return [...ids].sort((a, b) => {
    const nameA = names.get(a)
    const nameB = names.get(b)
    if (nameA !== undefined && nameB === undefined) return -1
    if (nameA === undefined && nameB !== undefined) return 1
    if (nameA !== undefined && nameB !== undefined) {
      const byName = nameA.localeCompare(nameB, 'en', { sensitivity: 'base' })
      if (byName !== 0) return byName
    }
    return a < b ? -1 : a > b ? 1 : 0
  })
}

/**
 * A submitted id list (the inline multi-select's value): unique, in the order
 * given. Throws when it is not a list of ids.
 */
export function parseIdList(wire: unknown): string[] {
  if (!Array.isArray(wire)) throw new Error('One or more selections are invalid')
  const ids: string[] = []
  for (const value of wire) {
    if (typeof value !== 'string' || !isUuid(value.trim())) {
      throw new Error('One or more selections are invalid')
    }
    const id = value.trim()
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}
