// Outbound sync queue for local-first drafts and record edits.
//
// One engine per browser tab (see `getDraftSyncEngine`). It owns every key's
// in-memory work (see model.ts), writes unsynced work to the device store,
// and delivers it to the server with retry + backoff. A key's queue is always
// its latest state: a whole-draft snapshot replaces the previous one, and
// record-page field edits (Builder records and every native module record)
// coalesce into one patch per field. The server rejects anything stale that
// was already in flight.
//
// Cross-tab safety: a mounted form holds a Web Lock on its draft key, and the
// background drain only touches keys whose lock it can take, so two tabs
// never advance the same device copy. Where Web Locks are unavailable the
// server ordering still prevents an older edit from overwriting a newer one;
// the device copy may just be refreshed by whichever tab wrote last.

import {
  acknowledge,
  applyFieldResults,
  clearRejections,
  dropFieldPatches,
  fieldQueueStatus,
  firstRejection,
  noteKnownValue,
  reconcileFieldPatch,
  hasFieldConflicts,
  markPatchesSent,
  isSyncDue,
  pendingCount,
  rebaseFieldConflicts,
  rejectOversizedPatches,
  recordFieldEdit,
  sendableFieldPatches,
  syncRetryDelayMs,
  workVersion,
  type DraftBlock,
  type DraftClientCursor,
  type DraftMeta,
  type DraftSnapshot,
  type DraftWork,
  type OfflineDraftRecord,
} from './model'
import { openDraftStore, type DraftStore } from './store'
import { createFetchDraftTransport, type DraftSyncRequest, type DraftTransport } from './transport'

/** Delay between the last device write and the server sync. */
export const SYNC_DEBOUNCE_MS = 1_200

export type DraftSyncState = {
  /** `device` when unsynced changes survive a reload; `memory` otherwise. */
  storage: 'device' | 'memory'
  /** True when the browser is offline or the last attempt could not connect. */
  offline: boolean
  /** Unsynced snapshots (guided fill) or fields (record page). */
  pending: number
  syncing: boolean
  lastSyncedAt: number | null
  error: string | null
  blocked: DraftBlock | null
  /** The entry was submitted elsewhere; nothing more will sync. */
  closed: boolean
}

export type FlushOutcome = { ok: true } | { ok: false; offline: boolean; error: string | null }

type HeldLock = { release: () => void }
type AcquireLock = (name: string, waitMs: number) => Promise<HeldLock | null>

type Entry = {
  meta: DraftMeta
  work: DraftWork
  persist: boolean
  owned: boolean
  attempts: number
  nextAttemptAt: number
  lastError: string | null
  lastAttemptOffline: boolean
  blocked: DraftBlock | null
  closed: boolean
  syncing: Promise<FlushOutcome> | null
  lastSyncedAt: number | null
  timer: ReturnType<typeof setTimeout> | null
}

const OFFLINE_ERROR = 'No connection. Changes are kept on this device.'
const TOO_LARGE_ERROR = 'These changes are too large to save.'

const IDLE_STATE: DraftSyncState = {
  storage: 'device',
  offline: false,
  pending: 0,
  syncing: false,
  lastSyncedAt: null,
  error: null,
  blocked: null,
  closed: false,
}

/** Web Locks wrapper. Without the API every request succeeds (no cross-tab guard). */
const acquireBrowserLock: AcquireLock = (name, waitMs) => {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) return Promise.resolve({ release() {} })
  return new Promise((resolve) => {
    let release!: () => void
    const held = new Promise<void>((done) => {
      release = done
    })
    const controller = waitMs > 0 ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), waitMs) : null
    locks
      .request(
        `beaconhs-offline-draft:${name}`,
        controller ? { signal: controller.signal } : { ifAvailable: true },
        (lock) => {
          if (timer) clearTimeout(timer)
          if (!lock) {
            resolve(null)
            return undefined
          }
          resolve({ release })
          return held
        },
      )
      .catch(() => {
        if (timer) clearTimeout(timer)
        resolve(null)
      })
  })
}

export class DraftSyncEngine {
  private store: DraftStore | null = null
  private storageFailed = false
  private readonly storeReady: Promise<DraftStore>
  private readonly entries = new Map<string, Entry>()
  /**
   * The request running for each key, kept apart from the entry: a key's entry
   * can be replaced (reopened, adopted by the background queue) while its
   * request is still in flight, and the next attempt must wait for it.
   */
  private readonly inflight = new Map<string, Promise<FlushOutcome>>()
  /** The latest device-store write, so callers can wait for it to commit. */
  private lastStoreWrite: Promise<void> = Promise.resolve()
  private readonly listeners = new Map<string, Set<() => void>>()
  private readonly states = new Map<string, DraftSyncState>()
  private online: boolean
  private readonly transport: DraftTransport
  private readonly now: () => number
  private readonly random: () => number
  readonly acquireLock: AcquireLock

  constructor(deps: {
    store: Promise<DraftStore>
    transport: DraftTransport
    online?: boolean
    now?: () => number
    random?: () => number
    acquireLock?: AcquireLock
  }) {
    this.transport = deps.transport
    this.now = deps.now ?? Date.now
    this.random = deps.random ?? Math.random
    this.online = deps.online ?? true
    this.acquireLock = deps.acquireLock ?? acquireBrowserLock
    this.storeReady = deps.store.then((store) => {
      this.store = store
      return store
    })
  }

  ready(): Promise<void> {
    return this.storeReady.then(() => undefined)
  }

  private get storageKind(): 'device' | 'memory' {
    return this.store?.kind === 'device' && !this.storageFailed ? 'device' : 'memory'
  }

  // --- Subscriptions ------------------------------------------------------

  subscribe(key: string, listener: () => void): () => void {
    let set = this.listeners.get(key)
    if (!set) {
      set = new Set()
      this.listeners.set(key, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  }

  getState(key: string): DraftSyncState {
    return this.states.get(key) ?? IDLE_STATE
  }

  /** A copy of the key's current work (cursor, snapshot, or field patches). */
  getWork(key: string): DraftWork | null {
    const entry = this.entries.get(key)
    return entry ? structuredCloneWork(entry.work) : null
  }

  /**
   * One field's place in a record's queue, encoded as a string so React can
   * compare snapshots cheaply: `none`, `pending`, `conflict`, or
   * `rejected:<reason>`.
   */
  fieldStatus(key: string, fieldId: string): string {
    const entry = this.entries.get(key)
    const status = fieldQueueStatus(entry?.work.kind === 'fields' ? entry.work : null, fieldId)
    return status.kind === 'rejected' ? `rejected:${status.error}` : status.kind
  }

  private emit(key: string): void {
    const entry = this.entries.get(key)
    if (entry) {
      const pending = pendingCount(entry.work)
      // A field the server refused keeps the record "not saved" until the
      // worker changes it, without holding back the record's other fields.
      const rejection = entry.work.kind === 'fields' ? firstRejection(entry.work) : null
      this.states.set(key, {
        storage: entry.persist ? this.storageKind : 'memory',
        offline: !this.online || (pending > 0 && entry.lastAttemptOffline),
        pending,
        syncing: entry.syncing !== null,
        lastSyncedAt: entry.lastSyncedAt,
        error: entry.lastError ?? rejection,
        blocked: entry.blocked ?? (rejection ? 'rejected' : null),
        closed: entry.closed,
      })
    } else {
      this.states.delete(key)
    }
    for (const listener of this.listeners.get(key) ?? []) listener()
  }

  setOnline(online: boolean): void {
    if (this.online === online) return
    this.online = online
    for (const key of this.entries.keys()) this.emit(key)
  }

  // --- Store access ---------------------------------------------------------

  /**
   * Run a store operation synchronously when the store is open (so it is
   * issued inside a `pagehide` handler), otherwise right after it opens.
   * Call order is preserved either way.
   */
  private withStore(run: (store: DraftStore) => Promise<void>): void {
    const onError = () => {
      if (this.storageFailed) return
      this.storageFailed = true
      for (const key of this.entries.keys()) this.emit(key)
    }
    const write = this.store
      ? run(this.store).catch(onError)
      : this.storeReady.then((store) => run(store)).catch(onError)
    this.lastStoreWrite = write
  }

  /** Resolves once every device-store write issued so far has committed. */
  async storeSettled(): Promise<void> {
    let pending: Promise<void>
    do {
      pending = this.lastStoreWrite
      await pending
    } while (pending !== this.lastStoreWrite)
  }

  private toRecord(entry: Entry): OfflineDraftRecord {
    return {
      ...entry.meta,
      work: structuredCloneWork(entry.work),
      updatedAt: this.now(),
      attempts: entry.attempts,
      nextAttemptAt: entry.nextAttemptAt,
      lastError: entry.lastError,
      blocked: entry.blocked,
    }
  }

  /** Write the entry's work to the device, or remove it once nothing is pending. */
  private persistEntry(entry: Entry): void {
    if (!entry.persist || this.storageFailed) return
    if (pendingCount(entry.work) === 0) {
      const version = workVersion(entry.work)
      this.withStore((store) => store.deleteIfAcknowledged(entry.meta.key, version))
      return
    }
    const record = this.toRecord(entry)
    this.withStore((store) => store.put(record))
  }

  /**
   * The freshest unsynced copy this tab holds for a key, if any. Covers a
   * form remounting in the same tab (and memory-only storage), where the
   * in-memory work can be newer than the device store.
   */
  inMemoryRecord(key: string): OfflineDraftRecord | null {
    const entry = this.entries.get(key)
    if (!entry || pendingCount(entry.work) === 0) return null
    return this.toRecord(entry)
  }

  async readStored(key: string): Promise<OfflineDraftRecord | null> {
    const store = await this.storeReady
    try {
      return await store.get(key)
    } catch {
      return null
    }
  }

  async listStored(scope: string): Promise<OfflineDraftRecord[]> {
    const store = await this.storeReady
    try {
      return await store.listByScope(scope)
    } catch {
      return []
    }
  }

  deleteStored(key: string): void {
    this.withStore((store) => store.delete(key))
  }

  // --- Form ownership -------------------------------------------------------

  /**
   * A mounted form registers a draft. `blocked: 'conflict'` marks work found
   * on load that the worker must resolve before it syncs.
   */
  open(
    meta: DraftMeta,
    work: DraftWork,
    opts: {
      persist: boolean
      owned: boolean
      blocked?: DraftBlock | null
      from?: Pick<OfflineDraftRecord, 'attempts' | 'nextAttemptAt' | 'lastError'>
    },
  ): void {
    const existing = this.entries.get(meta.key)
    if (existing?.timer) clearTimeout(existing.timer)
    const entry: Entry = {
      meta,
      work,
      persist: opts.persist,
      owned: opts.owned,
      attempts: opts.from?.attempts ?? 0,
      nextAttemptAt: opts.from?.nextAttemptAt ?? 0,
      lastError: opts.from?.lastError ?? null,
      lastAttemptOffline: false,
      blocked: opts.blocked ?? null,
      closed: false,
      syncing: null,
      lastSyncedAt: existing?.lastSyncedAt ?? null,
      timer: null,
    }
    this.entries.set(meta.key, entry)
    this.persistEntry(entry)
    this.emit(meta.key)
  }

  /** The form unmounted; background draining may now take the key. */
  release(key: string): void {
    const entry = this.entries.get(key)
    if (entry) entry.owned = false
  }

  // --- Edits ----------------------------------------------------------------

  private afterEdit(entry: Entry): void {
    // A rejected save (validation, permission) gets a fresh chance with the
    // worker's next change. A conflict stays until the worker chooses.
    if (entry.blocked === 'rejected') {
      entry.blocked = null
      entry.lastError = null
    }
    this.persistEntry(entry)
    this.emit(entry.meta.key)
    if (!entry.blocked) {
      this.scheduleSync(
        entry.meta.key,
        Math.max(SYNC_DEBOUNCE_MS, entry.nextAttemptAt - this.now()),
      )
    }
  }

  /** Guided fill: write a new whole-draft snapshot and queue it. */
  recordSnapshot(key: string, snapshot: DraftSnapshot): void {
    const entry = this.entries.get(key)
    if (!entry || entry.closed || entry.work.kind !== 'snapshot') return
    const { cursor } = entry.work
    entry.work = {
      ...entry.work,
      cursor: { ...cursor, sequence: cursor.sequence + 1 },
      snapshot,
    }
    this.afterEdit(entry)
  }

  /** Record page: queue one field's new value (coalesced per field). */
  recordField(key: string, fieldId: string, value: unknown, serverValue: unknown): void {
    const entry = this.entries.get(key)
    if (!entry || entry.closed || entry.work.kind !== 'fields') return
    entry.work = recordFieldEdit(entry.work, fieldId, value, serverValue)
    this.afterEdit(entry)
  }

  /** One-shot form: keep its latest answers on the device (never synced). */
  recordLocal(key: string, values: Record<string, unknown>): void {
    const entry = this.entries.get(key)
    if (!entry || entry.work.kind !== 'local') return
    entry.work = { kind: 'local', sequence: entry.work.sequence + 1, values }
    this.persistEntry(entry)
    this.emit(key)
  }

  /** One-shot form submitted (or started over): forget its device copy. */
  clearLocal(key: string): void {
    const entry = this.entries.get(key)
    if (!entry || entry.work.kind !== 'local') return
    entry.work = { kind: 'local', sequence: entry.work.sequence + 1, values: null }
    this.deleteStored(key)
    this.emit(key)
  }

  /** Fire-and-forget delivery of the latest work while the page hides. */
  beacon(key: string): void {
    const entry = this.entries.get(key)
    if (!entry || entry.blocked || entry.closed || !this.online) return
    const request = this.request(entry)
    if (request) this.transport.beacon(request.payload)
  }

  /** Sync now, resetting backoff; resolves once the server holds every edit. */
  async flush(key: string): Promise<FlushOutcome> {
    const entry = this.entries.get(key)
    if (!entry) return { ok: true }
    entry.attempts = 0
    entry.nextAttemptAt = 0
    let outcome: FlushOutcome = { ok: true }
    // Edits made while a save is in flight (or more patches than one request
    // carries) need further rounds.
    for (let round = 0; round < 5; round += 1) {
      outcome = await this.sync(key)
      if (!outcome.ok) return outcome
      const current = this.entries.get(key)
      if (!current || pendingCount(current.work) === 0) return { ok: true }
      if (current.blocked) return { ok: false, offline: false, error: current.lastError }
      if (current.work.kind === 'fields') {
        const rejection = firstRejection(current.work)
        if (rejection) return { ok: false, offline: false, error: rejection }
        if (hasFieldConflicts(current.work)) {
          return { ok: false, offline: false, error: current.lastError }
        }
      }
    }
    // Still edits waiting after every round (the worker kept typing): the
    // server does not hold everything yet, so a submit must not proceed.
    const remaining = this.entries.get(key)
    return remaining && pendingCount(remaining.work) > 0
      ? { ok: false, offline: false, error: null }
      : outcome
  }

  retry(key: string): void {
    const entry = this.entries.get(key)
    if (!entry || entry.blocked === 'conflict') return
    entry.blocked = null
    entry.lastError = null
    if (entry.work.kind === 'fields') entry.work = clearRejections(entry.work)
    this.persistEntry(entry)
    this.emit(key)
    void this.flush(key)
  }

  /**
   * Keep this device's copy: a snapshot rebases onto the server revision;
   * field patches rebase onto the values the server reported.
   */
  resolveConflict(key: string, revision: number | null): void {
    const entry = this.entries.get(key)
    if (!entry) return
    if (entry.work.kind === 'snapshot') {
      const baseRevision = revision ?? entry.work.conflictRevision ?? entry.work.cursor.baseRevision
      entry.work = {
        ...entry.work,
        cursor: { ...entry.work.cursor, baseRevision },
        conflictRevision: null,
      }
    } else if (entry.work.kind === 'fields') {
      entry.work = rebaseFieldConflicts(entry.work)
    }
    entry.blocked = null
    entry.lastError = null
    this.persistEntry(entry)
    this.emit(key)
    void this.flush(key)
  }

  /** Record a server value the page now shows for a field with no pending edit. */
  noteServerValue(key: string, fieldId: string, value: unknown): void {
    const entry = this.entries.get(key)
    if (!entry || entry.work.kind !== 'fields') return
    entry.work = noteKnownValue(entry.work, fieldId, value)
  }

  /**
   * A field appeared after the record was claimed: reconcile its device edit
   * with the value the page shows. Returns the device value to show, if any.
   */
  reconcileField(
    key: string,
    fieldId: string,
    server: unknown,
  ): { kind: 'restored' | 'conflicted'; value: unknown } | null {
    const entry = this.entries.get(key)
    if (!entry || entry.work.kind !== 'fields') return null
    const result = reconcileFieldPatch(entry.work, fieldId, server)
    if (result.outcome === 'none') return null
    entry.work = result.work
    if (result.outcome === 'conflicted') {
      entry.blocked = 'conflict'
      entry.lastError = 'This record was changed somewhere else.'
    }
    this.persistEntry(entry)
    this.emit(key)
    return result.outcome === 'dropped' ? null : { kind: result.outcome, value: result.value }
  }

  /** Drop field edits (the conflicted ones, or the listed fields). */
  dropFields(key: string, fieldIds: 'conflicts' | string[]): void {
    const entry = this.entries.get(key)
    if (!entry || entry.work.kind !== 'fields') return
    entry.work = dropFieldPatches(entry.work, fieldIds)
    if (entry.blocked === 'conflict' && !hasFieldConflicts(entry.work)) {
      entry.blocked = null
      entry.lastError = null
    }
    this.persistEntry(entry)
    this.emit(key)
    if (!entry.blocked && pendingCount(entry.work) > 0) void this.flush(key)
  }

  /** Drop the device snapshot and continue from a fresh cursor. */
  discardSnapshot(key: string, cursor: DraftClientCursor): void {
    const entry = this.entries.get(key)
    if (!entry || entry.work.kind !== 'snapshot') return
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    entry.work = { kind: 'snapshot', cursor, snapshot: null, conflictRevision: null }
    entry.blocked = null
    entry.lastError = null
    entry.attempts = 0
    entry.nextAttemptAt = 0
    this.deleteStored(key)
    this.emit(key)
  }

  // --- Sync -----------------------------------------------------------------

  private scheduleSync(key: string, delayMs: number): void {
    const entry = this.entries.get(key)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(
      () => {
        entry.timer = null
        void this.sync(key)
      },
      Math.max(0, delayMs),
    )
  }

  /** The request for the entry's pending work, plus what it covers. */
  private request(
    entry: Entry,
  ): { payload: DraftSyncRequest; sent: Record<string, number> | null } | null {
    const work = entry.work
    const meta = entry.meta
    if (work.kind === 'snapshot') {
      if (meta.target !== 'form' || !work.snapshot || pendingCount(work) === 0) return null
      return {
        sent: null,
        payload: {
          target: 'form',
          body: {
            scope: meta.scope,
            responseId: meta.responseId,
            values: work.snapshot.values,
            rows: work.snapshot.rows,
            stepIndex: work.snapshot.stepIndex,
            clientSessionId: work.cursor.sessionId,
            clientSequence: work.cursor.sequence,
            baseRevision: work.cursor.baseRevision,
            ...(work.cursor.serverCreated
              ? {}
              : {
                  create: {
                    templateId: meta.templateId,
                    complianceObligationId: meta.complianceObligationId,
                  },
                }),
          },
        },
      }
    }
    if (meta.target !== 'record' || work.kind !== 'fields') return null
    const checked = rejectOversizedPatches(work, TOO_LARGE_ERROR)
    const patches = sendableFieldPatches(checked)
    // Remember what this request carries, so a lost answer followed by a
    // newer edit is recognised as this device's own save (see model.ts).
    entry.work = markPatchesSent(checked, patches)
    this.persistEntry(entry)
    if (checked !== work) this.emit(meta.key)
    if (patches.length === 0) return null
    return {
      sent: Object.fromEntries(patches.map((patch) => [patch.fieldId, patch.sequence])),
      payload: {
        target: 'record',
        body: {
          scope: meta.scope,
          module: meta.module,
          recordId: meta.recordId,
          patches: patches.map(({ fieldId, value, base }) => ({ fieldId, value, base })),
        },
      },
    }
  }

  private async sync(key: string): Promise<FlushOutcome> {
    const existing = this.entries.get(key)
    if (!existing) return { ok: true }
    if (existing.syncing) return existing.syncing
    // A replaced entry's request may still be running: never send the key
    // twice at once.
    const prior = this.inflight.get(key)
    if (prior) await prior
    const entry = this.entries.get(key)
    if (!entry) return { ok: true }
    if (entry.syncing) return entry.syncing
    const run = this.attempt(entry).finally(() => {
      if (entry.syncing === run) entry.syncing = null
      if (this.inflight.get(key) === run) this.inflight.delete(key)
      this.emit(key)
    })
    entry.syncing = run
    this.inflight.set(key, run)
    this.emit(key)
    return run
  }

  private async attempt(entry: Entry): Promise<FlushOutcome> {
    const key = entry.meta.key
    if (entry.closed || entry.blocked) {
      return pendingCount(entry.work) === 0
        ? { ok: true }
        : { ok: false, offline: false, error: entry.lastError }
    }
    const request = this.request(entry)
    if (!request) return { ok: true }
    if (!this.online) {
      entry.lastAttemptOffline = true
      return { ok: false, offline: true, error: OFFLINE_ERROR }
    }
    if (entry.timer) {
      clearTimeout(entry.timer)
      entry.timer = null
    }

    const result = await this.transport.save(request.payload)
    // The entry may have been discarded or replaced while the request ran.
    if (this.entries.get(key) !== entry) return { ok: true }

    const settled = () => {
      entry.attempts = 0
      entry.nextAttemptAt = 0
      entry.lastError = null
      entry.lastAttemptOffline = false
      entry.lastSyncedAt = this.now()
    }

    switch (result.kind) {
      case 'ok': {
        if (entry.work.kind !== 'snapshot') return { ok: true }
        entry.work = { ...entry.work, cursor: acknowledge(entry.work.cursor, result) }
        if (pendingCount(entry.work) === 0) entry.work = { ...entry.work, snapshot: null }
        settled()
        this.persistEntry(entry)
        if (pendingCount(entry.work) > 0) this.scheduleSync(key, 0)
        return { ok: true }
      }
      case 'fields': {
        if (entry.work.kind !== 'fields') return { ok: true }
        entry.work = applyFieldResults(entry.work, request.sent ?? {}, result)
        settled()
        if (hasFieldConflicts(entry.work)) {
          entry.blocked = 'conflict'
          entry.lastError = 'This record was changed somewhere else.'
        }
        this.persistEntry(entry)
        if (!entry.blocked && sendableFieldPatches(entry.work, 1).length > 0) {
          this.scheduleSync(key, 0)
        }
        return entry.blocked ? { ok: false, offline: false, error: entry.lastError } : { ok: true }
      }
      case 'retry': {
        entry.attempts += 1
        const delay = syncRetryDelayMs(entry.attempts, this.random())
        entry.nextAttemptAt = this.now() + delay
        entry.lastError = result.error
        entry.lastAttemptOffline = result.offline
        this.persistEntry(entry)
        this.scheduleSync(key, delay)
        return { ok: false, offline: result.offline, error: result.error }
      }
      case 'conflict': {
        entry.blocked = 'conflict'
        if (entry.work.kind === 'snapshot') {
          entry.work = { ...entry.work, conflictRevision: result.revision }
        }
        entry.lastError = result.error
        entry.lastAttemptOffline = false
        this.persistEntry(entry)
        return { ok: false, offline: false, error: result.error }
      }
      case 'closed': {
        // Submitted elsewhere: the device copy can never apply. Drop it.
        entry.closed = true
        if (entry.work.kind === 'snapshot') entry.work = { ...entry.work, snapshot: null }
        else if (entry.work.kind === 'fields') entry.work = { ...entry.work, patches: {} }
        entry.lastError = result.error
        entry.lastAttemptOffline = false
        this.deleteStored(key)
        return { ok: false, offline: false, error: result.error }
      }
      case 'rejected': {
        entry.blocked = 'rejected'
        entry.lastError = result.error
        entry.lastAttemptOffline = false
        this.persistEntry(entry)
        return { ok: false, offline: false, error: result.error }
      }
    }
  }

  /**
   * Background queue: deliver every due device copy in a scope, including
   * drafts whose form is no longer open. `force` ignores backoff (used when
   * the connection or the tab comes back).
   */
  async drain(scope: string, opts: { force?: boolean } = {}): Promise<void> {
    if (!this.online) return
    const now = this.now()
    const work: Promise<unknown>[] = []
    // Drafts this tab is editing, and memory-only drafts (never in the device
    // store), are synced from memory. Everything else comes from the store.
    const inMemoryKeys = new Set<string>()
    for (const entry of this.entries.values()) {
      if (entry.meta.scope !== scope || (!entry.owned && entry.persist)) continue
      inMemoryKeys.add(entry.meta.key)
      if (entry.work.kind === 'local') continue // Never synced; submitted by its form.
      if (pendingCount(entry.work) === 0 || entry.blocked || entry.closed) continue
      if (opts.force || entry.nextAttemptAt <= now) work.push(this.flush(entry.meta.key))
    }
    for (const record of await this.listStored(scope)) {
      if (inMemoryKeys.has(record.key) || record.work.kind === 'local') continue
      if (record.blocked || pendingCount(record.work) === 0) continue
      if (!opts.force && !isSyncDue(record, now)) continue
      work.push(this.drainRecord(record.key))
    }
    await Promise.allSettled(work)
  }

  private async drainRecord(key: string): Promise<void> {
    const lock = await this.acquireLock(key, 0)
    if (!lock) return // A form in another tab owns it.
    try {
      const fresh = await this.readStored(key)
      if (!fresh || fresh.blocked || pendingCount(fresh.work) === 0) return
      if (this.entries.get(key)?.owned) return
      this.adoptRecord(fresh, { persist: true, owned: false })
      await this.flush(key)
    } finally {
      lock.release()
    }
  }

  /** Register a stored record as an entry (restore, conflict, or background). */
  adoptRecord(
    record: OfflineDraftRecord,
    opts: { persist: boolean; owned: boolean; blocked?: DraftBlock | null; work?: DraftWork },
  ): void {
    this.open(metaOf(record), opts.work ?? record.work, {
      persist: opts.persist,
      owned: opts.owned,
      blocked: opts.blocked === undefined ? record.blocked : opts.blocked,
      from: record,
    })
  }

  // --- Sign-out -------------------------------------------------------------

  /** Device copies for a user that still hold unsynced changes. */
  async pendingCountForUser(userId: string): Promise<number> {
    const keys = new Set<string>()
    for (const entry of this.entries.values()) {
      if (entry.meta.userId === userId && pendingCount(entry.work) > 0) keys.add(entry.meta.key)
    }
    const store = await this.storeReady
    try {
      for (const record of await store.listByUser(userId)) {
        if (pendingCount(record.work) > 0) keys.add(record.key)
      }
    } catch {
      // Device store unreadable — count what is in memory.
    }
    return keys.size
  }

  /** Remove every device copy belonging to a user (sign-out on a shared device). */
  async purgeUser(userId: string): Promise<void> {
    for (const [key, entry] of this.entries) {
      if (entry.meta.userId !== userId) continue
      if (entry.timer) clearTimeout(entry.timer)
      this.entries.delete(key)
      this.emit(key)
    }
    const store = await this.storeReady
    try {
      await store.deleteByUser(userId)
    } catch {
      // Nothing more can be done; the scope key still isolates the records.
    }
  }
}

/** The identity part of a stored record (everything but its queue state). */
function metaOf(record: OfflineDraftRecord): DraftMeta {
  const base = {
    key: record.key,
    scope: record.scope,
    tenantId: record.tenantId,
    userId: record.userId,
  }
  switch (record.target) {
    case 'form':
      return {
        ...base,
        target: 'form',
        templateId: record.templateId,
        responseId: record.responseId,
        complianceObligationId: record.complianceObligationId,
        origin: record.origin,
      }
    case 'record':
      return { ...base, target: 'record', module: record.module, recordId: record.recordId }
    case 'local':
      return { ...base, target: 'local', form: record.form, localId: record.localId }
  }
}

function structuredCloneWork(work: DraftWork): DraftWork {
  return typeof structuredClone === 'function'
    ? structuredClone(work)
    : (JSON.parse(JSON.stringify(work)) as DraftWork)
}

let singleton: DraftSyncEngine | null = null

/** The tab-wide engine. Browser only. */
export function getDraftSyncEngine(): DraftSyncEngine {
  if (!singleton) {
    singleton = new DraftSyncEngine({
      store: openDraftStore(),
      transport: createFetchDraftTransport(),
      online: typeof navigator === 'undefined' ? true : navigator.onLine,
    })
  }
  return singleton
}
