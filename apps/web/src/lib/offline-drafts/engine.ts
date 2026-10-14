// Outbound sync queue for local-first form drafts.
//
// One engine per browser tab (see `getDraftSyncEngine`). It owns every draft
// key's in-memory work (see model.ts), writes unsynced work to the device
// store, and delivers it to the server with retry + backoff. A key's queue is
// always its latest state: a whole-draft snapshot replaces the previous one,
// and record-page field edits coalesce into one patch per field. The server
// rejects anything stale that was already in flight.
//
// Cross-tab safety: a mounted form holds a Web Lock on its draft key, and the
// background drain only touches keys whose lock it can take, so two tabs
// never advance the same device copy. Where Web Locks are unavailable the
// server ordering still prevents an older edit from overwriting a newer one;
// the device copy may just be refreshed by whichever tab wrote last.

import {
  acknowledge,
  applyFieldResults,
  dropFieldPatches,
  hasFieldConflicts,
  isSyncDue,
  pendingCount,
  rebaseFieldConflicts,
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

  private emit(key: string): void {
    const entry = this.entries.get(key)
    if (entry) {
      const pending = pendingCount(entry.work)
      this.states.set(key, {
        storage: entry.persist ? this.storageKind : 'memory',
        offline: !this.online || (pending > 0 && entry.lastAttemptOffline),
        pending,
        syncing: entry.syncing !== null,
        lastSyncedAt: entry.lastSyncedAt,
        error: entry.lastError,
        blocked: entry.blocked,
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
    if (this.store) {
      run(this.store).catch(onError)
    } else {
      void this.storeReady.then((store) => run(store)).catch(onError)
    }
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
      syncing: existing?.syncing ?? null,
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
    // Edits made while a save is in flight need one more round.
    for (let round = 0; round < 3; round += 1) {
      outcome = await this.sync(key)
      if (!outcome.ok) return outcome
      const current = this.entries.get(key)
      if (!current || pendingCount(current.work) === 0) return { ok: true }
      if (current.blocked) return { ok: false, offline: false, error: current.lastError }
    }
    return outcome
  }

  retry(key: string): void {
    const entry = this.entries.get(key)
    if (!entry || entry.blocked === 'conflict') return
    entry.blocked = null
    entry.lastError = null
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
    } else {
      entry.work = rebaseFieldConflicts(entry.work)
    }
    entry.blocked = null
    entry.lastError = null
    this.persistEntry(entry)
    this.emit(key)
    void this.flush(key)
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
    if (work.kind === 'snapshot') {
      if (!work.snapshot || pendingCount(work) === 0) return null
      return {
        sent: null,
        payload: {
          responseId: entry.meta.responseId,
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
                  templateId: entry.meta.templateId,
                  complianceObligationId: entry.meta.complianceObligationId,
                },
              }),
        },
      }
    }
    const patches = sendableFieldPatches(work)
    if (patches.length === 0) return null
    return {
      sent: Object.fromEntries(patches.map((patch) => [patch.fieldId, patch.sequence])),
      payload: {
        kind: 'fields',
        responseId: entry.meta.responseId,
        patches: patches.map(({ fieldId, value, base }) => ({ fieldId, value, base })),
      },
    }
  }

  private async sync(key: string): Promise<FlushOutcome> {
    const entry = this.entries.get(key)
    if (!entry) return { ok: true }
    if (entry.syncing) await entry.syncing
    if (entry.syncing) return entry.syncing
    const run = this.attempt(entry).finally(() => {
      entry.syncing = null
      this.emit(key)
    })
    entry.syncing = run
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
        if (result.conflicts.length > 0) {
          entry.blocked = 'conflict'
          entry.lastError = 'This record was changed somewhere else.'
        }
        this.persistEntry(entry)
        if (!entry.blocked && pendingCount(entry.work) > 0) this.scheduleSync(key, 0)
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
        else entry.work = { ...entry.work, patches: {} }
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
      if (pendingCount(entry.work) === 0 || entry.blocked || entry.closed) continue
      if (opts.force || entry.nextAttemptAt <= now) work.push(this.flush(entry.meta.key))
    }
    for (const record of await this.listStored(scope)) {
      if (inMemoryKeys.has(record.key)) continue
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
    const meta: DraftMeta = {
      key: record.key,
      scope: record.scope,
      tenantId: record.tenantId,
      userId: record.userId,
      templateId: record.templateId,
      responseId: record.responseId,
      complianceObligationId: record.complianceObligationId,
      origin: record.origin,
    }
    this.open(meta, opts.work ?? record.work, {
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
