// API-key scope vocabulary:
//   read:*  / read:<entity>   — read every / one exposed entity
//   write:* / write:<entity>  — create on every / one writable entity
// A key stores the scopes it was granted (api_keys.scopes); keyCanRead/keyCanWrite
// gate each request. The catalog is derived from the read registry + the write
// handler registry, so it can never drift from what the API actually serves.

import { REPORT_ENTITIES, REPORT_ENTITY_MAP } from '@beaconhs/reports'
import { WRITABLE_ENTITY_KEYS } from './write'

export const READ_ALL_SCOPE = 'read:*'
export const WRITE_ALL_SCOPE = 'write:*'

export type ApiScope = {
  value: string
  label: string
  /** Grouping hint for the admin picker. */
  group: 'Read' | 'Write'
}

export const API_SCOPES: ApiScope[] = [
  { value: READ_ALL_SCOPE, label: 'Read — all data', group: 'Read' },
  ...REPORT_ENTITIES.map(
    (e): ApiScope => ({ value: `read:${e.key}`, label: `Read — ${e.label}`, group: 'Read' }),
  ),
  { value: WRITE_ALL_SCOPE, label: 'Write — all writable data', group: 'Write' },
  ...WRITABLE_ENTITY_KEYS.map(
    (key): ApiScope => ({
      value: `write:${key}`,
      label: `Write — ${REPORT_ENTITY_MAP[key]?.label ?? key}`,
      group: 'Write',
    }),
  ),
]

const VALID_SCOPES = new Set(API_SCOPES.map((s) => s.value))

export function isValidScope(scope: string): boolean {
  return VALID_SCOPES.has(scope)
}

/** Keep only recognised scopes; drops anything unknown so a stored key can
 *  never carry a scope the gate doesn't understand. */
export function sanitizeScopes(scopes: string[]): string[] {
  return [...new Set(scopes.filter(isValidScope))]
}

/** Can a key with these scopes read this entity? `read:*` covers everything. */
export function keyCanRead(scopes: string[], entityKey: string): boolean {
  return scopes.includes(READ_ALL_SCOPE) || scopes.includes(`read:${entityKey}`)
}

/** Can a key with these scopes create on this entity? `write:*` covers all. */
export function keyCanWrite(scopes: string[], entityKey: string): boolean {
  return scopes.includes(WRITE_ALL_SCOPE) || scopes.includes(`write:${entityKey}`)
}
