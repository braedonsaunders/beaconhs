'use client'

// The submission barrier. Before a record is submitted, locked, signed, or
// left for another record, everything the worker did on it must be on the
// server: queued field edits (every mounted offline record registers a
// flusher — see lib/offline-drafts) and uploads still attaching (tracked
// tasks). `flushRecordSaves` pushes both and throws when anything could not
// be delivered, so the action never runs against stale data.

const pending = new Map<symbol, Promise<unknown>>()
const failures = new Set<symbol>()
const flushers = new Set<() => Promise<void>>()

/** A submit waits for the same writes that drive each upload's saved indicator. */
export function trackRecordSave<T>(key: symbol, task: Promise<T>): Promise<T> {
  failures.delete(key)
  pending.set(key, task)
  void task.then(
    () => {
      if (pending.get(key) === task) {
        pending.delete(key)
        failures.delete(key)
      }
    },
    () => {
      if (pending.get(key) === task) {
        pending.delete(key)
        failures.add(key)
      }
    },
  )
  return task
}

export function forgetRecordSave(key: symbol) {
  failures.delete(key)
}

/**
 * Register a mounted record's flusher: commit its fields' unsaved input and
 * deliver its queued edits, throwing when they cannot reach the server.
 */
export function registerRecordFlusher(flush: () => Promise<void>): () => void {
  flushers.add(flush)
  return () => {
    flushers.delete(flush)
  }
}

export async function flushRecordSaves(): Promise<void> {
  const delivered = await Promise.allSettled([...flushers].map((flush) => flush()))
  while (pending.size) await Promise.all([...pending.values()])
  if (failures.size)
    throw new Error('Some changes could not be saved. Retry the failed fields before submitting.')
  for (const outcome of delivered) if (outcome.status === 'rejected') throw outcome.reason
}
