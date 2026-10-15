import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DraftSyncEngine, SYNC_DEBOUNCE_MS } from './engine'
import { createMemoryDraftStore, type DraftStore } from './store'
import type { DraftSyncRequest, DraftTransport } from './transport'
import {
  emptyFieldsWork,
  formDraftKey,
  localFormKey,
  recordEditsKey,
  type DraftClientCursor,
  type DraftSyncResult,
  type FormDraftMeta,
  type OfflineDraftRecord,
  type RecordEditsMeta,
  type SnapshotWork,
} from './model'
import type { DraftSaveRequest } from '@/app/(app)/apps/_lib/draft-persistence'
import type { RecordSyncRequest } from './protocol'

const SCOPE = 'tenant-1:user-1'

function meta(responseId = 'r-1', overrides: Partial<FormDraftMeta> = {}): FormDraftMeta {
  return {
    key: formDraftKey(SCOPE, responseId),
    scope: SCOPE,
    tenantId: 'tenant-1',
    userId: 'user-1',
    target: 'form',
    templateId: 'template-1',
    responseId,
    complianceObligationId: null,
    origin: 'new',
    ...overrides,
  }
}

function fieldsMeta(recordId = 'r-9', module: RecordEditsMeta['module'] = 'apps'): RecordEditsMeta {
  return {
    key: recordEditsKey(SCOPE, module, recordId),
    scope: SCOPE,
    tenantId: 'tenant-1',
    userId: 'user-1',
    target: 'record',
    module,
    recordId,
  }
}

/** Bodies sent to the guided-fill route. */
function snapshotsSent(sent: DraftSyncRequest[]): DraftSaveRequest[] {
  return sent.flatMap((request) => (request.target === 'form' ? [request.body] : []))
}

/** Bodies sent to the record sync route. */
function recordsSent(sent: DraftSyncRequest[]): RecordSyncRequest[] {
  return sent.flatMap((request) => (request.target === 'record' ? [request.body] : []))
}

const snapshot = (text: string) => ({ values: { note: text }, rows: {}, stepIndex: 0 })

function snapshotWork(overrides: Partial<DraftClientCursor> = {}): SnapshotWork {
  return {
    kind: 'snapshot',
    cursor: {
      sessionId: 'session-a',
      sequence: 0,
      ackedSequence: 0,
      baseRevision: 0,
      serverCreated: false,
      ...overrides,
    },
    snapshot: null,
    conflictRevision: null,
  }
}

function setup(results: Array<DraftSyncResult | Promise<DraftSyncResult>> = []) {
  // Behaves like IndexedDB for the engine: survives the page (`device`).
  const store: DraftStore = { ...createMemoryDraftStore(), kind: 'device' }
  const sent: DraftSyncRequest[] = []
  const queue = [...results]
  const transport: DraftTransport = {
    save: vi.fn(async (payload: DraftSyncRequest): Promise<DraftSyncResult> => {
      sent.push(payload)
      const next = queue.shift()
      if (next) return next
      if (payload.target === 'record') {
        return {
          kind: 'fields',
          applied: payload.body.patches.map((p) => ({ fieldId: p.fieldId, stored: p.value })),
          conflicts: [],
          rejected: [],
        }
      }
      return {
        kind: 'ok',
        revision: payload.body.baseRevision + 1,
        sequence: payload.body.clientSequence,
        savedAt: Date.now(),
      }
    }),
    beacon: vi.fn(),
  }
  const locks = new Set<string>()
  const engine = new DraftSyncEngine({
    store: Promise.resolve(store),
    transport,
    random: () => 0.5,
    acquireLock: async (name) => {
      if (locks.has(name)) return null
      locks.add(name)
      return { release: () => locks.delete(name) }
    },
  })
  return { engine, store, sent, transport, locks }
}

async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms)
}

const owned = { persist: true, owned: true }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-14T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('draft sync engine — whole-draft snapshots', () => {
  it('writes each snapshot to the device, then clears it once the server acknowledges', async () => {
    const { engine, store, sent } = setup()
    await engine.ready()
    engine.open(meta(), snapshotWork(), owned)
    engine.recordSnapshot(meta().key, snapshot('first'))
    await settle()
    const stored = await store.get(meta().key)
    expect(stored?.work).toMatchObject({ kind: 'snapshot', cursor: { sequence: 1 } })
    expect(engine.getState(meta().key)).toMatchObject({ pending: 1, storage: 'device' })

    await settle(SYNC_DEBOUNCE_MS)
    expect(sent).toHaveLength(1)
    // A device-minted entry carries the idempotent create block until acked.
    expect(sent[0]?.target).toBe('form')
    expect(snapshotsSent(sent)[0]).toMatchObject({
      responseId: 'r-1',
      clientSessionId: 'session-a',
      clientSequence: 1,
      baseRevision: 0,
      create: { templateId: 'template-1', complianceObligationId: null },
    })
    expect(await store.get(meta().key)).toBeNull()
    expect(engine.getState(meta().key)).toMatchObject({ pending: 0, lastSyncedAt: Date.now() })
    expect(engine.getWork(meta().key)).toMatchObject({
      cursor: { serverCreated: true, baseRevision: 1 },
    })

    engine.recordSnapshot(meta().key, snapshot('second'))
    await settle(SYNC_DEBOUNCE_MS)
    expect(snapshotsSent(sent)[1]).toMatchObject({ clientSequence: 2, baseRevision: 1 })
    expect(snapshotsSent(sent)[1]).not.toHaveProperty('create')
  })

  it('keeps the device copy while offline and delivers it when the connection returns', async () => {
    const { engine, store, sent } = setup()
    await engine.ready()
    engine.setOnline(false)
    engine.open(meta(), snapshotWork(), owned)
    engine.recordSnapshot(meta().key, snapshot('dead zone'))
    await settle(SYNC_DEBOUNCE_MS * 5)
    expect(sent).toHaveLength(0)
    expect(engine.getState(meta().key)).toMatchObject({ offline: true, pending: 1 })
    expect(await store.get(meta().key)).not.toBeNull()

    engine.setOnline(true)
    await engine.drain(SCOPE, { force: true })
    expect(sent).toHaveLength(1)
    expect(await store.get(meta().key)).toBeNull()
  })

  it('retries transient failures with backoff and persists the schedule', async () => {
    const { engine, store, sent } = setup([
      { kind: 'retry', error: 'No connection.', offline: true },
      { kind: 'retry', error: 'No connection.', offline: true },
    ])
    await engine.ready()
    engine.open(meta(), snapshotWork(), owned)
    engine.recordSnapshot(meta().key, snapshot('x'))
    await settle(SYNC_DEBOUNCE_MS)
    expect(sent).toHaveLength(1)
    const stored = await store.get(meta().key)
    expect(stored).toMatchObject({ attempts: 1, nextAttemptAt: Date.now() + 2_000 })
    expect(engine.getState(meta().key)).toMatchObject({ offline: true, pending: 1 })

    await settle(1_999)
    expect(sent).toHaveLength(1)
    await settle(1)
    expect(sent).toHaveLength(2)
    await settle(4_000)
    expect(sent).toHaveLength(3)
    expect(await store.get(meta().key)).toBeNull()
  })

  it('never loses an edit made while an older save is in flight', async () => {
    let finishFirst!: (result: DraftSyncResult) => void
    const first = new Promise<DraftSyncResult>((resolve) => {
      finishFirst = resolve
    })
    const { engine, store, sent } = setup([first])
    await engine.ready()
    engine.open(meta(), snapshotWork({ serverCreated: true }), owned)
    engine.recordSnapshot(meta().key, snapshot('one'))
    await settle(SYNC_DEBOUNCE_MS)
    engine.recordSnapshot(meta().key, snapshot('two'))
    // While sequence 1 is in flight the device holds sequence 2.
    const held = await store.get(meta().key)
    expect(held?.work.kind === 'snapshot' && held.work.snapshot?.values).toEqual({ note: 'two' })
    finishFirst({ kind: 'ok', revision: 1, sequence: 1, savedAt: Date.now() })
    await settle()
    // The ack for 1 does not clear 2: it is sent straight away.
    expect(snapshotsSent(sent).map((p) => [p.clientSequence, p.values.note])).toEqual([
      [1, 'one'],
      [2, 'two'],
    ])
    expect(await store.get(meta().key)).toBeNull()
  })

  it('holds a conflicting copy until the worker keeps it, then rebases onto the server revision', async () => {
    const { engine, store, sent } = setup([
      { kind: 'conflict', error: 'changed elsewhere', revision: 9 },
    ])
    await engine.ready()
    engine.open(meta(), snapshotWork({ serverCreated: true, baseRevision: 4 }), owned)
    engine.recordSnapshot(meta().key, snapshot('mine'))
    await settle(SYNC_DEBOUNCE_MS)
    expect(engine.getState(meta().key)).toMatchObject({ blocked: 'conflict' })
    engine.recordSnapshot(meta().key, snapshot('still mine'))
    await settle(SYNC_DEBOUNCE_MS * 3)
    expect(sent).toHaveLength(1)
    expect((await store.get(meta().key))?.blocked).toBe('conflict')

    engine.resolveConflict(meta().key, null)
    await settle()
    expect(snapshotsSent(sent)[1]).toMatchObject({ baseRevision: 9, clientSequence: 2 })
    expect(await store.get(meta().key)).toBeNull()
  })

  it('drops the device copy once the entry was submitted elsewhere', async () => {
    const { engine, store } = setup([{ kind: 'closed', error: 'already submitted' }])
    await engine.ready()
    engine.open(meta(), snapshotWork({ serverCreated: true }), owned)
    engine.recordSnapshot(meta().key, snapshot('late'))
    await settle(SYNC_DEBOUNCE_MS)
    expect(await store.get(meta().key)).toBeNull()
    expect(engine.getState(meta().key)).toMatchObject({ closed: true, pending: 0 })
  })

  it('drains copies left by an earlier page, but not ones another tab is editing', async () => {
    const { engine, store, sent, locks } = setup()
    await engine.ready()
    const record = (responseId: string): OfflineDraftRecord => ({
      ...meta(responseId),
      work: {
        ...snapshotWork({ sequence: 3, ackedSequence: 1, serverCreated: true }),
        snapshot: snapshot(responseId),
      },
      updatedAt: Date.now(),
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      blocked: null,
    })
    await store.put(record('left-behind'))
    await store.put(record('open-elsewhere'))
    await store.put({ ...record('other-user'), scope: 'tenant-1:user-2', userId: 'user-2' })
    locks.add(meta('open-elsewhere').key)

    await engine.drain(SCOPE)
    expect(snapshotsSent(sent).map((p) => p.responseId)).toEqual(['left-behind'])
    expect(await store.get(meta('left-behind').key)).toBeNull()
    expect(await store.get(meta('open-elsewhere').key)).not.toBeNull()
  })

  it('counts and purges only the signed-out user’s copies', async () => {
    const { engine, store } = setup()
    await engine.ready()
    engine.setOnline(false)
    engine.open(meta(), snapshotWork(), owned)
    engine.recordSnapshot(meta().key, snapshot('mine'))
    await store.put({
      ...meta('theirs', {
        scope: 'tenant-1:user-2',
        userId: 'user-2',
        key: formDraftKey('tenant-1:user-2', 'theirs'),
      }),
      work: { ...snapshotWork({ sequence: 1 }), snapshot: snapshot('theirs') },
      updatedAt: Date.now(),
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      blocked: null,
    })
    await settle()
    expect(await engine.pendingCountForUser('user-1')).toBe(1)
    await engine.purgeUser('user-1')
    expect(await engine.pendingCountForUser('user-1')).toBe(0)
    expect(await store.get(formDraftKey('tenant-1:user-2', 'theirs'))).not.toBeNull()
  })

  it('reports memory-only storage when the device store is unavailable', async () => {
    const { engine } = setup()
    await engine.ready()
    engine.open(meta(), snapshotWork(), { persist: false, owned: true })
    engine.recordSnapshot(meta().key, snapshot('x'))
    expect(engine.getState(meta().key).storage).toBe('memory')
  })
})

describe('draft sync engine — record-page field edits', () => {
  it('coalesces edits per field, sends base values, and clears the device copy once applied', async () => {
    const { engine, store, sent } = setup()
    await engine.ready()
    const key = fieldsMeta().key
    engine.open(fieldsMeta(), emptyFieldsWork(), owned)
    engine.recordField(key, 'crew', 'A', '')
    engine.recordField(key, 'crew', 'AB', '')
    engine.recordField(key, 'hazards', ['fall'], null)
    await settle()
    expect(engine.getState(key)).toMatchObject({ pending: 2, storage: 'device' })
    expect((await store.get(key))?.work).toMatchObject({ kind: 'fields', sequence: 3 })

    await settle(SYNC_DEBOUNCE_MS)
    expect(sent).toEqual([
      {
        target: 'record',
        body: {
          scope: SCOPE,
          module: 'apps',
          recordId: 'r-9',
          patches: [
            { fieldId: 'crew', value: 'AB', base: '' },
            { fieldId: 'hazards', value: ['fall'], base: null },
          ],
        },
      },
    ])
    expect(await store.get(key)).toBeNull()
    expect(engine.getState(key)).toMatchObject({ pending: 0, lastSyncedAt: Date.now() })

    // The next edit is based on the value the server confirmed.
    engine.recordField(key, 'crew', 'ABC', 'stale page value')
    await settle(SYNC_DEBOUNCE_MS)
    expect(recordsSent(sent)[1]).toMatchObject({
      patches: [{ fieldId: 'crew', value: 'ABC', base: 'AB' }],
    })
  })

  it('keeps unsent edits and rebases a field edited again while its save was in flight', async () => {
    let finish!: (result: DraftSyncResult) => void
    const first = new Promise<DraftSyncResult>((resolve) => {
      finish = resolve
    })
    const { engine, sent } = setup([first])
    await engine.ready()
    const key = fieldsMeta().key
    engine.open(fieldsMeta(), emptyFieldsWork(), owned)
    engine.recordField(key, 'crew', 'A', '')
    await settle(SYNC_DEBOUNCE_MS)
    engine.recordField(key, 'crew', 'AB', '')
    finish({
      kind: 'fields',
      applied: [{ fieldId: 'crew', stored: 'A' }],
      conflicts: [],
      rejected: [],
    })
    await settle()
    expect(recordsSent(sent)[1]).toMatchObject({
      patches: [{ fieldId: 'crew', value: 'AB', base: 'A' }],
    })
  })

  it('holds conflicting fields for the worker while other fields still sync', async () => {
    const { engine, store, sent } = setup([
      {
        kind: 'fields',
        applied: [{ fieldId: 'notes', stored: 'ok' }],
        conflicts: [{ fieldId: 'crew', current: 'Theirs' }],
        rejected: [],
      },
    ])
    await engine.ready()
    const key = fieldsMeta().key
    engine.setOnline(false)
    engine.open(fieldsMeta(), emptyFieldsWork(), owned)
    engine.recordField(key, 'crew', 'Mine', 'Original')
    engine.recordField(key, 'notes', 'ok', '')
    engine.setOnline(true)
    await engine.flush(key)
    expect(engine.getState(key)).toMatchObject({ blocked: 'conflict', pending: 1 })
    expect((await store.get(key))?.blocked).toBe('conflict')

    // Keep this device's copy: rebased onto the server's value and resent.
    engine.resolveConflict(key, null)
    await settle()
    expect(recordsSent(sent)[1]).toMatchObject({
      patches: [{ fieldId: 'crew', value: 'Mine', base: 'Theirs' }],
    })
    expect(await store.get(key)).toBeNull()
  })

  it('drops only the conflicting fields when the worker keeps the saved version', async () => {
    const { engine } = setup([
      {
        kind: 'fields',
        applied: [],
        conflicts: [{ fieldId: 'crew', current: 'Theirs' }],
        rejected: [],
      },
    ])
    await engine.ready()
    const key = fieldsMeta().key
    engine.open(fieldsMeta(), emptyFieldsWork(), owned)
    engine.recordField(key, 'crew', 'Mine', 'Original')
    await engine.flush(key)
    engine.dropFields(key, 'conflicts')
    expect(engine.getState(key)).toMatchObject({ blocked: null, pending: 0 })
  })
})

describe('draft sync engine — native record edits', () => {
  it('sends each module record to the record sync route with its module and record id', async () => {
    const { engine, sent } = setup()
    await engine.ready()
    const incident = fieldsMeta('inc-1', 'incidents')
    engine.open(incident, emptyFieldsWork(), owned)
    engine.recordField(incident.key, 'title', 'Ladder slip', 'Ladder')
    await settle(SYNC_DEBOUNCE_MS)
    expect(sent).toEqual([
      {
        target: 'record',
        body: {
          scope: SCOPE,
          module: 'incidents',
          recordId: 'inc-1',
          patches: [{ fieldId: 'title', value: 'Ladder slip', base: 'Ladder' }],
        },
      },
    ])
  })

  it('holds a refused field until it changes, while the record’s other fields keep syncing', async () => {
    const { engine, sent } = setup([
      {
        kind: 'fields',
        applied: [{ fieldId: 'location', stored: 'Bay 4' }],
        conflicts: [],
        rejected: [{ fieldId: 'title', error: 'Title is required.' }],
      },
    ])
    await engine.ready()
    const record = fieldsMeta('inc-2', 'incidents')
    engine.open(record, emptyFieldsWork(), owned)
    engine.recordField(record.key, 'title', '', 'Old title')
    engine.recordField(record.key, 'location', 'Bay 4', '')
    const outcome = await engine.flush(record.key)
    expect(outcome).toEqual({ ok: false, offline: false, error: 'Title is required.' })
    expect(engine.getState(record.key)).toMatchObject({
      pending: 1,
      blocked: 'rejected',
      error: 'Title is required.',
    })
    expect(engine.fieldStatus(record.key, 'title')).toBe('rejected:Title is required.')
    expect(engine.fieldStatus(record.key, 'location')).toBe('none')

    // A refused value is not resent on its own…
    await settle(SYNC_DEBOUNCE_MS * 5)
    expect(sent).toHaveLength(1)
    // …but a new value clears the refusal and syncs.
    engine.recordField(record.key, 'title', 'Ladder slip', 'Old title')
    expect(engine.getState(record.key).blocked).toBeNull()
    await settle(SYNC_DEBOUNCE_MS)
    expect(recordsSent(sent)[1]).toMatchObject({
      patches: [{ fieldId: 'title', value: 'Ladder slip', base: 'Old title' }],
    })
    expect(engine.getState(record.key)).toMatchObject({ pending: 0, blocked: null })
  })

  it('bases later edits on a newer server value the page has shown', async () => {
    const { engine, sent } = setup()
    await engine.ready()
    const record = fieldsMeta('inc-3', 'incidents')
    engine.open(record, emptyFieldsWork(), owned)
    engine.recordField(record.key, 'title', 'Mine', 'Original')
    await settle(SYNC_DEBOUNCE_MS)
    // Someone else changed it; the refreshed page shows their value.
    engine.noteServerValue(record.key, 'title', 'Theirs')
    engine.recordField(record.key, 'title', 'Mine again', 'Original')
    await settle(SYNC_DEBOUNCE_MS)
    expect(recordsSent(sent)[1]).toMatchObject({
      patches: [{ fieldId: 'title', value: 'Mine again', base: 'Theirs' }],
    })
  })

  it('reconciles a field that appears after the record was claimed', async () => {
    const { engine } = setup()
    await engine.ready()
    const record = fieldsMeta('inc-4', 'incidents')
    engine.setOnline(false)
    engine.open(record, emptyFieldsWork(), owned)
    engine.recordField(record.key, 'rows:a:answer', 'pass', '')
    engine.recordField(record.key, 'rows:b:answer', 'fail', '')
    engine.recordField(record.key, 'rows:c:answer', 'n_a', '')
    expect(engine.reconcileField(record.key, 'rows:a:answer', '')).toEqual({
      kind: 'restored',
      value: 'pass',
    })
    // Already on the server (e.g. a beacon landed): dropped.
    expect(engine.reconcileField(record.key, 'rows:b:answer', 'fail')).toBeNull()
    expect(engine.getState(record.key).pending).toBe(2)
    // Changed elsewhere: held for the worker.
    expect(engine.reconcileField(record.key, 'rows:c:answer', 'pass')).toEqual({
      kind: 'conflicted',
      value: 'n_a',
    })
    expect(engine.getState(record.key).blocked).toBe('conflict')
  })

  it('splits a large backlog across requests without losing any field', async () => {
    const { engine, sent } = setup()
    await engine.ready()
    const record = fieldsMeta('inc-5', 'incidents')
    engine.setOnline(false)
    engine.open(record, emptyFieldsWork(), owned)
    for (let index = 0; index < 150; index += 1) {
      engine.recordField(record.key, `rows:${index}:answer`, 'pass', '')
    }
    engine.setOnline(true)
    expect(await engine.flush(record.key)).toEqual({ ok: true })
    const batches = recordsSent(sent)
    expect(batches.map((batch) => batch.patches.length)).toEqual([100, 50])
    expect(new Set(batches.flatMap((batch) => batch.patches.map((p) => p.fieldId))).size).toBe(150)
    expect(engine.getState(record.key).pending).toBe(0)
  })
})

describe('draft sync engine — one-shot forms kept on the device', () => {
  const localMeta = {
    key: localFormKey(SCOPE, 'ppe-inspection', 'item:i-1:pre_use'),
    scope: SCOPE,
    tenantId: 'tenant-1',
    userId: 'user-1',
    target: 'local' as const,
    form: 'ppe-inspection',
    localId: 'item:i-1:pre_use',
  }

  it('keeps the latest answers on the device, never sends them, and forgets them once submitted', async () => {
    const { engine, store, sent } = setup()
    await engine.ready()
    engine.open(localMeta, { kind: 'local', sequence: 0, values: null }, owned)
    engine.recordLocal(localMeta.key, { answers: { a: 'pass' } })
    engine.recordLocal(localMeta.key, { answers: { a: 'fail' } })
    await settle(SYNC_DEBOUNCE_MS * 5)
    expect((await store.get(localMeta.key))?.work).toEqual({
      kind: 'local',
      sequence: 2,
      values: { answers: { a: 'fail' } },
    })
    expect(engine.getState(localMeta.key)).toMatchObject({ pending: 1, storage: 'device' })
    await engine.drain(SCOPE, { force: true })
    expect(sent).toEqual([])
    // Unsubmitted answers count as unsynced work when signing out.
    expect(await engine.pendingCountForUser('user-1')).toBe(1)

    engine.clearLocal(localMeta.key)
    await settle()
    expect(await store.get(localMeta.key)).toBeNull()
    expect(engine.getState(localMeta.key).pending).toBe(0)
  })

  it('leaves another page’s stored answers alone when draining', async () => {
    const { engine, store, sent } = setup()
    await engine.ready()
    await store.put({
      ...localMeta,
      work: { kind: 'local', sequence: 3, values: { notes: 'left behind' } },
      updatedAt: Date.now(),
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      blocked: null,
    })
    await engine.drain(SCOPE, { force: true })
    expect(sent).toEqual([])
    expect(await store.get(localMeta.key)).not.toBeNull()
  })
})

describe('draft sync engine — interrupted requests', () => {
  it('keeps syncing a record reopened while its previous request was still in flight', async () => {
    let finish!: (result: DraftSyncResult) => void
    const first = new Promise<DraftSyncResult>((resolve) => {
      finish = resolve
    })
    const { engine, sent } = setup([first])
    await engine.ready()
    const record = fieldsMeta('inc-7', 'incidents')
    engine.open(record, emptyFieldsWork(), owned)
    engine.recordField(record.key, 'title', 'A', '')
    await settle(SYNC_DEBOUNCE_MS)
    expect(sent).toHaveLength(1)
    // The page leaves and comes back (or the background queue adopts it).
    const reopened = engine.getWork(record.key)!
    engine.open(record, reopened, owned)
    finish({
      kind: 'fields',
      applied: [{ fieldId: 'title', stored: 'A' }],
      conflicts: [],
      rejected: [],
    })
    await settle()
    engine.recordField(record.key, 'notes', 'n', '')
    expect(await engine.flush(record.key)).toEqual({ ok: true })
    expect(recordsSent(sent).flatMap((batch) => batch.patches.map((p) => p.fieldId))).toContain(
      'notes',
    )
    expect(engine.getState(record.key)).toMatchObject({ pending: 0, syncing: false })
  })

  it('does not raise a conflict when its own lost save is what the server now holds', async () => {
    const { engine, sent } = setup([
      { kind: 'retry', error: 'No connection.', offline: true },
      {
        kind: 'fields',
        applied: [],
        conflicts: [{ fieldId: 'title', current: 'v1' }],
        rejected: [],
      },
    ])
    await engine.ready()
    const record = fieldsMeta('inc-8', 'incidents')
    engine.open(record, emptyFieldsWork(), owned)
    engine.recordField(record.key, 'title', 'v1', 'v0')
    await settle(SYNC_DEBOUNCE_MS) // sent; the answer never arrives
    engine.recordField(record.key, 'title', 'v2', 'v0')
    await engine.flush(record.key)
    expect(engine.getState(record.key).blocked).toBeNull()
    expect(recordsSent(sent).at(-1)).toMatchObject({
      patches: [{ fieldId: 'title', value: 'v2', base: 'v1' }],
    })
    expect(engine.getState(record.key).pending).toBe(0)
  })
})
