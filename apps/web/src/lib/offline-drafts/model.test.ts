import { describe, expect, it } from 'vitest'
import {
  acknowledge,
  applyFieldResults,
  clearRejections,
  draftScopeKey,
  emptyFieldsWork,
  fieldQueueStatus,
  formDraftKey,
  isSyncDue,
  jsonEqual,
  noteKnownValue,
  pendingCount,
  reconcileDeviceDraft,
  reconcileFieldPatch,
  reconcileFieldPatches,
  recordEditsKey,
  markPatchesSent,
  MAX_PATCH_BYTES,
  recordFieldEdit,
  rejectOversizedPatches,
  sendableFieldPatches,
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
    expect(formDraftKey(own, 'r1')).not.toBe(formDraftKey(otherUser, 'r1'))
    expect(formDraftKey(own, 'r1')).not.toBe(recordEditsKey(own, 'apps', 'r1'))
    expect(recordEditsKey(own, 'incidents', 'r1')).not.toBe(recordEditsKey(own, 'apps', 'r1'))
    expect(recordEditsKey(impersonated, 'incidents', 'r1')).not.toBe(
      recordEditsKey(own, 'incidents', 'r1'),
    )
    expect(recordEditsKey(own, 'incidents', 'r1').startsWith(`${own}|`)).toBe(true)
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
        rejected: [{ fieldId: 'b', error: 'Bad' }],
      }),
    ).toEqual({
      kind: 'fields',
      applied: [{ fieldId: 'a', stored: 1 }],
      conflicts: [],
      rejected: [{ fieldId: 'b', error: 'Bad' }],
    })
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
    expect(work.patches.crew).toEqual({
      value: 'AB',
      base: 'server',
      sequence: 2,
      conflict: null,
      rejected: null,
      sent: [],
    })
  })

  it('applies acks without dropping a newer edit, and records conflicts', () => {
    let work = recordFieldEdit(emptyFieldsWork(), 'crew', 'A', '')
    work = recordFieldEdit(work, 'notes', 'n', '')
    const sent = { crew: 1, notes: 2 }
    work = recordFieldEdit(work, 'crew', 'AB', '') // edited while in flight
    work = applyFieldResults(work, sent, {
      applied: [{ fieldId: 'crew', stored: 'A' }],
      conflicts: [{ fieldId: 'notes', current: 'theirs' }],
      rejected: [],
    })
    expect(work.patches.crew).toMatchObject({ value: 'AB', base: 'A', conflict: null })
    expect(work.patches.notes?.conflict).toEqual({ current: 'theirs' })
    expect(work.known.crew).toBe('A')
  })

  it('restores only edits whose base still matches the server', () => {
    let work = recordFieldEdit(emptyFieldsWork(), 'unchanged', 'mine', 'orig')
    work = recordFieldEdit(work, 'delivered', 'mine', 'orig')
    work = recordFieldEdit(work, 'changed', 'mine', 'orig')
    const server: Record<string, unknown> = {
      unchanged: 'orig',
      delivered: 'mine',
      changed: 'theirs',
    }
    const outcome = reconcileFieldPatches(work, (fieldId) => ({ value: server[fieldId] }))
    expect(outcome.restored).toEqual({ unchanged: 'mine' })
    expect(outcome.conflicted).toEqual({ changed: 'mine' })
    expect(Object.keys(outcome.work.patches).sort()).toEqual(['changed', 'unchanged'])
    expect(outcome.work.patches.changed?.conflict).toEqual({ current: 'theirs' })
  })
})

describe('record edits: refusals, late fields, and known values', () => {
  it('marks only fields refused for the value that was sent, and lets a new value through', () => {
    let work = recordFieldEdit(emptyFieldsWork(), 'title', '', 'Old')
    work = recordFieldEdit(work, 'notes', 'n', '')
    const sent = { title: 1, notes: 2 }
    work = applyFieldResults(work, sent, {
      applied: [{ fieldId: 'notes', stored: 'n' }],
      conflicts: [],
      rejected: [{ fieldId: 'title', error: 'Title is required.' }],
    })
    expect(fieldQueueStatus(work, 'title')).toEqual({
      kind: 'rejected',
      error: 'Title is required.',
    })
    expect(fieldQueueStatus(work, 'notes')).toEqual({ kind: 'none' })
    expect(sendableFieldPatches(work)).toEqual([])
    expect(pendingCount(work)).toBe(1)

    // Retry resends; a new edit replaces the refused value and keeps the base.
    expect(sendableFieldPatches(clearRejections(work))).toHaveLength(1)
    work = recordFieldEdit(work, 'title', 'New', 'ignored')
    expect(work.patches.title).toMatchObject({ value: 'New', base: 'Old', rejected: null })
  })

  it('does not mark a field refused when it was edited again after the request left', () => {
    let work = recordFieldEdit(emptyFieldsWork(), 'title', '', 'Old')
    work = recordFieldEdit(work, 'title', 'Fixed', 'Old')
    work = applyFieldResults(
      work,
      { title: 1 },
      { applied: [], conflicts: [], rejected: [{ fieldId: 'title', error: 'Required.' }] },
    )
    expect(work.patches.title?.rejected).toBeNull()
  })

  it('sends the oldest edits first and caps a request', () => {
    let work = emptyFieldsWork()
    for (let index = 0; index < 5; index += 1) {
      work = recordFieldEdit(work, `f${index}`, index, null)
    }
    expect(sendableFieldPatches(work, 2).map((patch) => patch.fieldId)).toEqual(['f0', 'f1'])
  })

  it('leaves edits for fields the page has not shown to the server’s compare-and-set', () => {
    const work = recordFieldEdit(emptyFieldsWork(), 'rows:9:answer', 'pass', '')
    const outcome = reconcileFieldPatches(work, () => null)
    expect(outcome.restored).toEqual({})
    expect(outcome.work.patches['rows:9:answer']).toMatchObject({ value: 'pass', conflict: null })
  })

  it('reconciles one late field without forgetting what the server confirmed', () => {
    let work = recordFieldEdit(emptyFieldsWork(), 'a', 'mine', 'orig')
    work = noteKnownValue(work, 'b', 'confirmed')
    const restored = reconcileFieldPatch(work, 'a', 'orig')
    expect(restored).toMatchObject({ outcome: 'restored', value: 'mine' })
    expect(restored.work.known.b).toBe('confirmed')
    expect(reconcileFieldPatch(work, 'a', 'mine').outcome).toBe('dropped')
    const conflicted = reconcileFieldPatch(work, 'a', 'theirs')
    expect(conflicted.outcome).toBe('conflicted')
    expect(conflicted.work.patches.a?.conflict).toEqual({ current: 'theirs' })
    expect(reconcileFieldPatch(work, 'missing', 'x').outcome).toBe('none')
  })

  it('records a newer server value only for fields without a pending edit', () => {
    const pending = recordFieldEdit(emptyFieldsWork(), 'a', 'mine', 'orig')
    expect(noteKnownValue(pending, 'a', 'theirs')).toBe(pending)
    expect(noteKnownValue(pending, 'b', 'x').known).toEqual({ b: 'x' })
  })
})

describe('record edits: lost answers and large values', () => {
  it('treats the server holding a value this device already sent as its own save, not a conflict', () => {
    // v1 was sent and stored, but the answer was lost; then the worker typed v2.
    let work = recordFieldEdit(emptyFieldsWork(), 'title', 'v1', 'v0')
    work = markPatchesSent(work, [{ fieldId: 'title', value: 'v1' }])
    work = recordFieldEdit(work, 'title', 'v2', 'ignored')
    work = applyFieldResults(
      work,
      { title: 2 },
      { applied: [], conflicts: [{ fieldId: 'title', current: 'v1' }], rejected: [] },
    )
    expect(work.patches.title).toMatchObject({ value: 'v2', base: 'v1', conflict: null })
    // Someone else's value is still a conflict.
    work = applyFieldResults(
      work,
      { title: 2 },
      { applied: [], conflicts: [{ fieldId: 'title', current: 'theirs' }], rejected: [] },
    )
    expect(work.patches.title?.conflict).toEqual({ current: 'theirs' })
  })

  it('restores, rather than conflicts, a device edit whose earlier value already landed', () => {
    let work = recordFieldEdit(emptyFieldsWork(), 'title', 'v1', 'v0')
    work = markPatchesSent(work, [{ fieldId: 'title', value: 'v1' }])
    work = recordFieldEdit(work, 'title', 'v2', 'ignored')
    const outcome = reconcileFieldPatches(work, () => ({ value: 'v1' }))
    expect(outcome.restored).toEqual({ title: 'v2' })
    expect(outcome.work.patches.title).toMatchObject({ base: 'v1', conflict: null })
  })

  it('splits large values across requests and refuses one that can never fit', () => {
    const big = 'x'.repeat(400 * 1024)
    let work = recordFieldEdit(emptyFieldsWork(), 'a', big, '')
    work = recordFieldEdit(work, 'b', big, '')
    work = recordFieldEdit(work, 'c', 'small', '')
    expect(sendableFieldPatches(work).map((patch) => patch.fieldId)).toEqual(['a'])
    const huge = recordFieldEdit(emptyFieldsWork(), 'sig', 'x'.repeat(MAX_PATCH_BYTES + 1), '')
    const refused = rejectOversizedPatches(huge, 'Too large.')
    expect(refused.patches.sig?.rejected).toBe('Too large.')
    expect(sendableFieldPatches(refused)).toEqual([])
    expect(rejectOversizedPatches(work, 'Too large.')).toBe(work)
  })
})
