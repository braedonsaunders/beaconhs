import { describe, expect, it } from 'vitest'
import {
  acknowledge,
  applyFieldResults,
  draftRecordKey,
  draftScopeKey,
  emptyFieldsWork,
  isSyncDue,
  jsonEqual,
  pendingCount,
  reconcileDeviceDraft,
  reconcileFieldPatches,
  recordFieldEdit,
  syncRetryDelayMs,
  SYNC_RETRY_MAX_MS,
  type DraftClientCursor,
  type OfflineDraftRecord,
} from './model'
import { classifyDraftSaveResponse } from './transport'

function cursor(overrides: Partial<DraftClientCursor> = {}): DraftClientCursor {
  return {
    sessionId: 'device-session',
    sequence: 5,
    ackedSequence: 3,
    baseRevision: 4,
    serverCreated: true,
    ...overrides,
  }
}

describe('device draft scoping', () => {
  it('separates tenants, users, and impersonation sessions', () => {
    const own = draftScopeKey({ tenantId: 't1', userId: 'u1', actorUserId: null })
    const otherUser = draftScopeKey({ tenantId: 't1', userId: 'u2', actorUserId: null })
    const otherTenant = draftScopeKey({ tenantId: 't2', userId: 'u1', actorUserId: null })
    const impersonated = draftScopeKey({ tenantId: 't1', userId: 'u1', actorUserId: 'admin' })
    expect(new Set([own, otherUser, otherTenant, impersonated]).size).toBe(4)
    expect(draftRecordKey(own, 'snapshot', 'r1')).not.toBe(
      draftRecordKey(otherUser, 'snapshot', 'r1'),
    )
    expect(draftRecordKey(own, 'snapshot', 'r1')).not.toBe(draftRecordKey(own, 'fields', 'r1'))
    expect(draftRecordKey(own, 'fields', 'r1').startsWith(`${own}|`)).toBe(true)
  })
})

describe('reconciling a device copy with the server draft', () => {
  it('restores a copy the server has never seen', () => {
    expect(reconcileDeviceDraft(cursor(), null)).toEqual({ kind: 'restore' })
  })

  it('restores when the same session has newer local snapshots', () => {
    const server = { revision: 6, sessionId: 'device-session', sequence: 3 }
    expect(reconcileDeviceDraft(cursor(), server)).toEqual({ kind: 'restore' })
  })

  it('discards when the same session already delivered everything (e.g. a beacon landed)', () => {
    const server = { revision: 7, sessionId: 'device-session', sequence: 5 }
    expect(reconcileDeviceDraft(cursor(), server)).toEqual({ kind: 'discard' })
  })

  it('restores when another session has not written since this copy was based', () => {
    const server = { revision: 4, sessionId: 'other-tab', sequence: 9 }
    expect(reconcileDeviceDraft(cursor(), server)).toEqual({ kind: 'restore' })
  })

  it('reports a conflict when another session saved after this copy was based', () => {
    const server = { revision: 5, sessionId: 'other-tab', sequence: 1 }
    expect(reconcileDeviceDraft(cursor(), server)).toEqual({
      kind: 'conflict',
      serverRevision: 5,
    })
  })

  it('discards a copy with nothing pending', () => {
    const synced = cursor({ sequence: 3, ackedSequence: 3 })
    expect(reconcileDeviceDraft(synced, null)).toEqual({ kind: 'discard' })
  })
})

describe('acknowledgements', () => {
  it('advances the acked sequence and base revision without passing local edits', () => {
    const next = acknowledge(cursor({ serverCreated: false }), { revision: 9, sequence: 4 })
    expect(next).toMatchObject({ ackedSequence: 4, baseRevision: 9, serverCreated: true })
    expect(
      pendingCount({ kind: 'snapshot', cursor: next, snapshot: null, conflictRevision: null }),
    ).toBe(0)
    expect(next.sequence - next.ackedSequence).toBe(1)
  })

  it('never moves backwards on a late, older acknowledgement', () => {
    const next = acknowledge(cursor({ ackedSequence: 5 }), { revision: 2, sequence: 1 })
    expect(next.ackedSequence).toBe(5)
    expect(next.baseRevision).toBe(4)
  })
})

describe('retry backoff', () => {
  it('grows exponentially with bounded jitter and a five-minute cap', () => {
    expect(syncRetryDelayMs(1, 0.5)).toBe(2_000)
    expect(syncRetryDelayMs(2, 0.5)).toBe(4_000)
    expect(syncRetryDelayMs(3, 0.5)).toBe(8_000)
    expect(syncRetryDelayMs(1, 0)).toBe(1_600)
    expect(syncRetryDelayMs(1, 1)).toBe(2_400)
    expect(syncRetryDelayMs(30, 1)).toBe(SYNC_RETRY_MAX_MS)
  })

  it('only queues unblocked records whose backoff has elapsed', () => {
    const work = {
      kind: 'snapshot' as const,
      cursor: cursor(),
      snapshot: { values: {}, rows: {}, stepIndex: 0 },
      conflictRevision: null,
    }
    const base = { work, blocked: null, nextAttemptAt: 1_000 } as OfflineDraftRecord
    expect(isSyncDue(base, 999)).toBe(false)
    expect(isSyncDue(base, 1_000)).toBe(true)
    expect(isSyncDue({ ...base, blocked: 'conflict' }, 5_000)).toBe(false)
    expect(
      isSyncDue({ ...base, work: { ...work, cursor: cursor({ ackedSequence: 5 }) } }, 5_000),
    ).toBe(false)
  })
})

describe('classifying draft-route responses', () => {
  it('maps the server reason onto queue behaviour', () => {
    expect(
      classifyDraftSaveResponse(200, {
        ok: true,
        savedAt: '2026-10-14T12:00:00.000Z',
        revision: 3,
        sequence: 7,
      }),
    ).toEqual({ kind: 'ok', revision: 3, sequence: 7, savedAt: Date.parse('2026-10-14T12:00:00Z') })
    expect(
      classifyDraftSaveResponse(200, {
        ok: true,
        kind: 'fields',
        applied: [{ fieldId: 'a', stored: 1 }],
        conflicts: [],
      }),
    ).toEqual({ kind: 'fields', applied: [{ fieldId: 'a', stored: 1 }], conflicts: [] })
    expect(
      classifyDraftSaveResponse(409, {
        ok: false,
        error: 'changed',
        reason: 'conflict',
        revision: 8,
      }),
    ).toEqual({ kind: 'conflict', error: 'changed', revision: 8 })
    expect(classifyDraftSaveResponse(409, { ok: false, error: 'done', reason: 'closed' })).toEqual({
      kind: 'closed',
      error: 'done',
    })
    expect(
      classifyDraftSaveResponse(503, { ok: false, error: 'busy', reason: 'unavailable' }).kind,
    ).toBe('retry')
    expect(classifyDraftSaveResponse(401, null).kind).toBe('retry')
    expect(classifyDraftSaveResponse(502, null).kind).toBe('retry')
    expect(classifyDraftSaveResponse(400, { ok: false, error: 'bad', reason: 'invalid' })).toEqual({
      kind: 'rejected',
      error: 'bad',
    })
  })
})

describe('record-page field patches', () => {
  it('compares answers structurally, ignoring key order and null vs missing', () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true)
    expect(jsonEqual(null, undefined)).toBe(true)
    expect(jsonEqual({ a: null }, {})).toBe(true)
    expect(jsonEqual([1, 2], [2, 1])).toBe(false)
    expect(jsonEqual('1', 1)).toBe(false)
  })

  it('coalesces edits to one patch per field and keeps the first base', () => {
    let work = recordFieldEdit(emptyFieldsWork(), 'crew', 'A', 'server')
    work = recordFieldEdit(work, 'crew', 'AB', 'ignored')
    work = recordFieldEdit(work, 'notes', 'x', null)
    expect(pendingCount(work)).toBe(2)
    expect(work.patches.crew).toEqual({ value: 'AB', base: 'server', sequence: 2, conflict: null })
  })

  it('applies acks without dropping a newer edit, and records conflicts', () => {
    let work = recordFieldEdit(emptyFieldsWork(), 'crew', 'A', '')
    work = recordFieldEdit(work, 'notes', 'n', '')
    const sent = { crew: 1, notes: 2 }
    work = recordFieldEdit(work, 'crew', 'AB', '') // edited while in flight
    work = applyFieldResults(work, sent, {
      applied: [{ fieldId: 'crew', stored: 'A' }],
      conflicts: [{ fieldId: 'notes', current: 'theirs' }],
    })
    expect(work.patches.crew).toMatchObject({ value: 'AB', base: 'A', conflict: null })
    expect(work.patches.notes?.conflict).toEqual({ current: 'theirs' })
    expect(work.known.crew).toBe('A')
  })

  it('restores only edits whose base still matches the server', () => {
    let work = recordFieldEdit(emptyFieldsWork(), 'unchanged', 'mine', 'orig')
    work = recordFieldEdit(work, 'delivered', 'mine', 'orig')
    work = recordFieldEdit(work, 'changed', 'mine', 'orig')
    const outcome = reconcileFieldPatches(work, {
      unchanged: 'orig',
      delivered: 'mine',
      changed: 'theirs',
    })
    expect(outcome.restored).toEqual({ unchanged: 'mine' })
    expect(outcome.conflicted).toEqual({ changed: 'mine' })
    expect(Object.keys(outcome.work.patches).sort()).toEqual(['changed', 'unchanged'])
    expect(outcome.work.patches.changed?.conflict).toEqual({ current: 'theirs' })
  })
})
