import { describe, expect, it } from 'vitest'
import {
  decideWopiLock,
  decideWopiPut,
  parseWopiTimestamp,
  readWopiLockHeader,
  wopiTimestampsMatch,
} from './wopi-protocol'

const NOW = Date.parse('2026-09-29T18:11:22.123Z')
const SERVER = new Date(NOW)

describe('wopi timestamps', () => {
  it('treats Collabora’s seven-digit fractional seconds as the same instant', () => {
    expect(parseWopiTimestamp('2026-09-29T18:11:22.1230000Z')).toBe(NOW)
    expect(wopiTimestampsMatch('2026-09-29T18:11:22.1230000Z', SERVER)).toBe(true)
    expect(wopiTimestampsMatch('2026-09-29T18:11:22.123Z', SERVER)).toBe(true)
    expect(wopiTimestampsMatch('2026-09-29T18:11:22.1230000+00:00', SERVER)).toBe(true)
  })

  it('rejects a timestamp that is actually a different time', () => {
    expect(wopiTimestampsMatch('2026-09-29T18:11:30.000Z', SERVER)).toBe(false)
    expect(wopiTimestampsMatch('not-a-date', SERVER)).toBe(false)
  })
})

describe('wopi locks', () => {
  it('rejects lock headers that could break the response', () => {
    expect(readWopiLockHeader('abc')).toEqual({ ok: true, lock: 'abc' })
    expect(readWopiLockHeader('  ')).toEqual({ ok: true, lock: null })
    expect(readWopiLockHeader(`bad\r\nX-Ignore: 1`)).toEqual({ ok: false })
    expect(readWopiLockHeader('x'.repeat(1025))).toEqual({ ok: false })
  })

  it('acquires, refreshes, and replaces a lock for the same session', () => {
    expect(
      decideWopiLock({
        override: 'LOCK',
        requestLock: 'session-a',
        oldLock: null,
        storedLock: null,
        storedLockExpiresAt: null,
        now: NOW,
      }),
    ).toEqual({ kind: 'ok', lock: 'session-a' })

    const expires = new Date(NOW + 60_000)
    expect(
      decideWopiLock({
        override: 'REFRESH_LOCK',
        requestLock: 'session-a',
        oldLock: null,
        storedLock: 'session-a',
        storedLockExpiresAt: expires,
        now: NOW,
      }),
    ).toEqual({ kind: 'ok', lock: 'session-a' })

    expect(
      decideWopiLock({
        override: 'LOCK',
        requestLock: 'session-b',
        oldLock: 'session-a',
        storedLock: 'session-a',
        storedLockExpiresAt: expires,
        now: NOW,
      }),
    ).toEqual({ kind: 'ok', lock: 'session-b' })
  })

  it('refuses a different session and an unlock of an expired lock', () => {
    const expires = new Date(NOW + 60_000)
    expect(
      decideWopiLock({
        override: 'LOCK',
        requestLock: 'session-b',
        oldLock: null,
        storedLock: 'session-a',
        storedLockExpiresAt: expires,
        now: NOW,
      }),
    ).toEqual({ kind: 'mismatch', currentLock: 'session-a' })

    expect(
      decideWopiLock({
        override: 'UNLOCK',
        requestLock: 'session-a',
        oldLock: null,
        storedLock: 'session-a',
        storedLockExpiresAt: new Date(NOW - 1),
        now: NOW,
      }),
    ).toEqual({ kind: 'mismatch', currentLock: '' })
  })
})

describe('wopi put decisions', () => {
  const base = {
    serverUpdatedAt: SERVER,
    storedLock: 'session-a',
    storedLockExpiresAt: new Date(NOW + 60_000),
    requestTicket: 2,
    appliedTicket: 1,
    now: NOW,
  }

  it('lets the lock holder save even when the echoed timestamp string differs', () => {
    expect(
      decideWopiPut({
        ...base,
        clientStamp: '2026-09-29T18:00:00.0000000Z',
        requestLock: 'session-a',
      }),
    ).toEqual({ kind: 'apply' })
  })

  it('drops an older in-flight save without calling it a conflict', () => {
    expect(
      decideWopiPut({
        ...base,
        clientStamp: SERVER.toISOString(),
        requestLock: 'session-a',
        requestTicket: 1,
        appliedTicket: 2,
      }),
    ).toEqual({ kind: 'superseded' })
  })

  it('reports a real external change only when nobody holds the lock', () => {
    expect(
      decideWopiPut({
        ...base,
        clientStamp: '2026-09-29T18:00:00.000Z',
        requestLock: null,
        storedLock: null,
        storedLockExpiresAt: null,
      }),
    ).toEqual({ kind: 'conflict' })
  })

  it('rejects a put that does not hold the current lock', () => {
    expect(
      decideWopiPut({
        ...base,
        clientStamp: SERVER.toISOString(),
        requestLock: 'session-b',
      }),
    ).toEqual({ kind: 'lock_mismatch', currentLock: 'session-a' })
  })
})
