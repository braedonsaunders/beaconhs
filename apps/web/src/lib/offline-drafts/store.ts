// Device storage for unsynced form drafts.
//
// A tiny hand-written IndexedDB wrapper (no dependency) plus an in-memory
// fallback with the same interface. The fallback is used when IndexedDB is
// missing or refuses to open (some private-browsing modes): drafts still sync
// to the server exactly as before, they just do not survive a reload.
//
// Ordering: every operation opens its transaction synchronously once the
// database is open, and IndexedDB runs read-write transactions on the same
// store in creation order. A save issued from a `pagehide` handler therefore
// reaches the disk queue before the page is frozen, and an older
// "delete if acknowledged" can never overtake a newer write.

import { workVersion, type OfflineDraftRecord } from './model'

export interface DraftStore {
  readonly kind: 'device' | 'memory'
  get(key: string): Promise<OfflineDraftRecord | null>
  put(record: OfflineDraftRecord): Promise<void>
  /** Delete only if the stored copy holds no edit newer than `version`. */
  deleteIfAcknowledged(key: string, version: number): Promise<void>
  delete(key: string): Promise<void>
  listByScope(scope: string): Promise<OfflineDraftRecord[]>
  listByUser(userId: string): Promise<OfflineDraftRecord[]>
  deleteByUser(userId: string): Promise<void>
}

const DB_NAME = 'beaconhs-offline-drafts'
const DB_VERSION = 1
const STORE = 'drafts'

function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T)
}

export function createMemoryDraftStore(): DraftStore {
  const records = new Map<string, OfflineDraftRecord>()
  return {
    kind: 'memory',
    async get(key) {
      const record = records.get(key)
      return record ? clone(record) : null
    },
    async put(record) {
      records.set(record.key, clone(record))
    },
    async deleteIfAcknowledged(key, version) {
      const record = records.get(key)
      if (record && workVersion(record.work) <= version) records.delete(key)
    },
    async delete(key) {
      records.delete(key)
    },
    async listByScope(scope) {
      return [...records.values()].filter((r) => r.scope === scope).map(clone)
    },
    async listByUser(userId) {
      return [...records.values()].filter((r) => r.userId === userId).map(clone)
    },
    async deleteByUser(userId) {
      for (const [key, record] of records) if (record.userId === userId) records.delete(key)
    },
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
  })
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(DB_NAME, DB_VERSION)
    } catch (error) {
      reject(error)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex('scope', 'scope', { unique: false })
        store.createIndex('userId', 'userId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    request.onblocked = () => reject(new Error('IndexedDB open blocked'))
  })
}

function createIndexedDbDraftStore(db: IDBDatabase): DraftStore {
  // Another tab upgrading the schema closes this connection; the store then
  // throws and the engine falls back to memory for the rest of the page life.
  db.onversionchange = () => db.close()

  function write(run: (store: IDBObjectStore) => void): Promise<void> {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const done = transactionDone(tx)
      try {
        run(tx.objectStore(STORE))
      } catch (error) {
        tx.abort()
        void done.catch(() => undefined)
        throw error
      }
      return done
    } catch (error) {
      return Promise.reject(error)
    }
  }

  async function readIndex(index: 'scope' | 'userId', value: string) {
    const tx = db.transaction(STORE, 'readonly')
    const rows = await requestResult(tx.objectStore(STORE).index(index).getAll(value))
    return rows as OfflineDraftRecord[]
  }

  return {
    kind: 'device',
    async get(key) {
      const tx = db.transaction(STORE, 'readonly')
      const row = await requestResult(tx.objectStore(STORE).get(key))
      return (row as OfflineDraftRecord | undefined) ?? null
    },
    put(record) {
      return write((store) => store.put(record))
    },
    deleteIfAcknowledged(key, version) {
      return write((store) => {
        const request = store.get(key)
        request.onsuccess = () => {
          const row = request.result as OfflineDraftRecord | undefined
          if (row && workVersion(row.work) <= version) store.delete(key)
        }
      })
    },
    delete(key) {
      return write((store) => store.delete(key))
    },
    listByScope(scope) {
      return readIndex('scope', scope)
    },
    listByUser(userId) {
      return readIndex('userId', userId)
    },
    async deleteByUser(userId) {
      const keys = (await readIndex('userId', userId)).map((r) => r.key)
      if (keys.length === 0) return
      await write((store) => {
        for (const key of keys) store.delete(key)
      })
    },
  }
}

/** Open the device store, or fall back to memory when IndexedDB is unusable. */
export async function openDraftStore(): Promise<DraftStore> {
  const factory = typeof indexedDB === 'undefined' ? null : indexedDB
  if (!factory) return createMemoryDraftStore()
  try {
    return createIndexedDbDraftStore(await openDatabase(factory))
  } catch {
    return createMemoryDraftStore()
  }
}
