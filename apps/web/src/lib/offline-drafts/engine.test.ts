import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DraftSyncEngine, SYNC_DEBOUNCE_MS } from './engine'
import { createMemoryDraftStore, type DraftStore } from './store'
import type { DraftSyncRequest, DraftTransport } from './transport'
import {
  emptyFieldsWork,
  type DraftClientCursor,
  type DraftMeta,
  type DraftSyncResult,
  type OfflineDraftRecord,
  type SnapshotWork,
} from './model'

const SCOPE = 'tenant-1:user-1'

function meta(responseId = 'r-1', overrides: Partial<DraftMeta> = {}): DraftMeta {
  return {
    key: `${SCOPE}|snapshot|${responseId}`,
    scope: SCOPE,
    tenantId: 'tenant-1',
    userId: 'user-1',
    templateId: 'template-1',
    responseId,
    complianceObligationId: null,
    origin: 'new',
    ...overrides,
  }
}

const fieldsMeta = (responseId = 'r-9') =>
  meta(responseId, { key: `${SCOPE}|fields|${responseId}`, origin: 'resume' })

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
      if ('patches' in payload) {
        return {
          kind: 'fields',
          applied: payload.patches.map((p) => ({ fieldId: p.fieldId, stored: p.value })),
          conflicts: [],
        }
      }
      return {
        kind: 'ok',
        revision: payload.baseRevision + 1,
        sequence: payload.clientSequence,
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
    expect(sent[0]).toMatchObject({
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
    expect(sent[1]).toMatchObject({ clientSequence: 2, baseRevision: 1 })
    expect(sent[1]).not.toHaveProperty('create')
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
    expect(
      sent.map((p) => ('clientSequence' in p ? [p.clientSequence, p.values.note] : [])),
    ).toEqual([
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
    expect(sent[1]).toMatchObject({ baseRevision: 9, clientSequence: 2 })
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
    expect(sent.map((p) => p.responseId)).toEqual(['left-behind'])
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
        key: 'tenant-1:user-2|snapshot|theirs',
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
    expect(await store.get('tenant-1:user-2|snapshot|theirs')).not.toBeNull()
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
        kind: 'fields',
        responseId: 'r-9',
        patches: [
          { fieldId: 'crew', value: 'AB', base: '' },
          { fieldId: 'hazards', value: ['fall'], base: null },
        ],
      },
    ])
    expect(await store.get(key)).toBeNull()
    expect(engine.getState(key)).toMatchObject({ pending: 0, lastSyncedAt: Date.now() })

    // The next edit is based on the value the server confirmed.
    engine.recordField(key, 'crew', 'ABC', 'stale page value')
    await settle(SYNC_DEBOUNCE_MS)
    expect(sent[1]).toMatchObject({ patches: [{ fieldId: 'crew', value: 'ABC', base: 'AB' }] })
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
    finish({ kind: 'fields', applied: [{ fieldId: 'crew', stored: 'A' }], conflicts: [] })
    await settle()
    expect(sent[1]).toMatchObject({ patches: [{ fieldId: 'crew', value: 'AB', base: 'A' }] })
  })

  it('holds conflicting fields for the worker while other fields still sync', async () => {
    const { engine, store, sent } = setup([
      {
        kind: 'fields',
        applied: [{ fieldId: 'notes', stored: 'ok' }],
        conflicts: [{ fieldId: 'crew', current: 'Theirs' }],
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
    expect(sent[1]).toMatchObject({ patches: [{ fieldId: 'crew', value: 'Mine', base: 'Theirs' }] })
    expect(await store.get(key)).toBeNull()
  })

  it('drops only the conflicting fields when the worker keeps the saved version', async () => {
    const { engine } = setup([
      { kind: 'fields', applied: [], conflicts: [{ fieldId: 'crew', current: 'Theirs' }] },
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
