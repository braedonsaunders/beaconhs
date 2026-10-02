'use client'

const pending = new Map<symbol, Promise<unknown>>()
const failures = new Set<symbol>()
export const FLUSH_RECORD_SAVES = 'beacon:flush-record-saves'

/** A submit waits for the same writes that drive each field's saved indicator. */
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

export async function flushRecordSaves(): Promise<void> {
  window.dispatchEvent(new Event(FLUSH_RECORD_SAVES))
  while (pending.size) await Promise.all([...pending.values()])
  if (failures.size)
    throw new Error('Some changes could not be saved. Retry the failed fields before submitting.')
}
