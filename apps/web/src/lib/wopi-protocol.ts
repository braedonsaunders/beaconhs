// Pure WOPI lock and save decisions for Collabora.
//
// Collabora echoes LastModifiedTime back in a different ISO shape than
// Date.toISOString() (seven fractional digits, or an offset instead of Z).
// A raw string compare turns that echo into a false storage conflict.
// Locks identify the editing session, and a monotonic save ticket keeps an
// older autosave from overwriting the publish save or raising that dialog.

export const WOPI_LOCK_TTL_MS = 30 * 60 * 1000
const TIMESTAMP_TOLERANCE_MS = 1500

export type WopiLockOverride = 'LOCK' | 'UNLOCK' | 'REFRESH_LOCK' | 'GET_LOCK'

export type WopiLockDecision =
  { kind: 'ok'; lock: string } | { kind: 'mismatch'; currentLock: string } | { kind: 'bad_request' }

export type WopiPutDecision =
  | { kind: 'apply' }
  | { kind: 'superseded' }
  | { kind: 'lock_mismatch'; currentLock: string }
  | { kind: 'conflict' }

/** Reject header values that could break the WOPI lock response header. */
export function readWopiLockHeader(
  value: string | null,
): { ok: true; lock: string | null } | { ok: false } {
  if (value == null) return { ok: true, lock: null }
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, lock: null }
  if (trimmed.length > 1024 || /[\u0000-\u001f\u007f]/u.test(trimmed)) return { ok: false }
  return { ok: true, lock: trimmed }
}

/**
 * Parse a Collabora/WOPI timestamp. Fractional seconds longer than
 * milliseconds are truncated so `.1230000Z` and `.123Z` are the same instant.
 */
export function parseWopiTimestamp(stamp: string): number | null {
  const trimmed = stamp.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(/(\.\d{3})\d+(?=(?:Z|[+-]\d{2}:?\d{2})$)/iu, '$1')
  const ms = Date.parse(normalized)
  return Number.isFinite(ms) ? ms : null
}

export function wopiTimestampsMatch(clientStamp: string | null, serverTime: Date): boolean {
  if (!clientStamp) return true
  const clientMs = parseWopiTimestamp(clientStamp)
  if (clientMs === null) return false
  return Math.abs(clientMs - serverTime.getTime()) <= TIMESTAMP_TOLERANCE_MS
}

/** The lock Collabora still holds, or null when missing or expired. */
function activeWopiLock(
  lock: string | null,
  expiresAt: Date | null,
  now: number,
): string | null {
  if (!lock || !expiresAt) return null
  if (expiresAt.getTime() <= now) return null
  return lock
}

export function decideWopiLock(input: {
  override: WopiLockOverride
  requestLock: string | null
  oldLock: string | null
  storedLock: string | null
  storedLockExpiresAt: Date | null
  now: number
}): WopiLockDecision {
  const current = activeWopiLock(input.storedLock, input.storedLockExpiresAt, input.now) ?? ''
  if (input.override === 'GET_LOCK') return { kind: 'ok', lock: current }
  if (!input.requestLock) return { kind: 'bad_request' }

  if (input.override === 'LOCK') {
    if (input.oldLock) {
      if (current !== input.oldLock) return { kind: 'mismatch', currentLock: current }
      return { kind: 'ok', lock: input.requestLock }
    }
    if (!current || current === input.requestLock) return { kind: 'ok', lock: input.requestLock }
    return { kind: 'mismatch', currentLock: current }
  }

  if (input.override === 'REFRESH_LOCK' || input.override === 'UNLOCK') {
    if (!current || current !== input.requestLock) return { kind: 'mismatch', currentLock: current }
    return { kind: 'ok', lock: input.override === 'UNLOCK' ? '' : input.requestLock }
  }

  return { kind: 'bad_request' }
}

export function decideWopiPut(input: {
  clientStamp: string | null
  serverUpdatedAt: Date
  requestLock: string | null
  storedLock: string | null
  storedLockExpiresAt: Date | null
  requestTicket: number
  appliedTicket: number
  now: number
}): WopiPutDecision {
  if (input.requestTicket < input.appliedTicket) return { kind: 'superseded' }
  const current = activeWopiLock(input.storedLock, input.storedLockExpiresAt, input.now)
  if (current && input.requestLock !== current) {
    return { kind: 'lock_mismatch', currentLock: current }
  }
  // The lock holder is this editing session. Its previous save moved
  // updated_at; that must not come back as a storage conflict.
  if (!current && !wopiTimestampsMatch(input.clientStamp, input.serverUpdatedAt)) {
    return { kind: 'conflict' }
  }
  return { kind: 'apply' }
}
