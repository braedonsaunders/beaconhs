// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  flushRecordSaves,
  forgetRecordSave,
  registerRecordFlusher,
  trackRecordSave,
} from './pending-record-saves'

describe('record submission save barrier', () => {
  it('flushes mounted records and waits for upload and attachment writes', async () => {
    let release!: () => void
    let linked = false
    let flushed = false
    const key = Symbol()
    const unregister = registerRecordFlusher(async () => {
      flushed = true
    })
    void trackRecordSave(
      key,
      new Promise<void>((resolve) => {
        release = () => {
          linked = true
          resolve()
        }
      }),
    )
    const flush = flushRecordSaves()
    expect(linked).toBe(false)
    release()
    await flush
    expect(flushed).toBe(true)
    expect(linked).toBe(true)
    unregister()
  })

  it('does not let another successful field hide a failed save', async () => {
    const failed = Symbol(),
      successful = Symbol()
    await expect(trackRecordSave(failed, Promise.reject(new Error('offline')))).rejects.toThrow(
      'offline',
    )
    await trackRecordSave(successful, Promise.resolve())
    await expect(flushRecordSaves()).rejects.toThrow('Some changes could not be saved')
    await trackRecordSave(failed, Promise.resolve())
    await expect(flushRecordSaves()).resolves.toBeUndefined()
    forgetRecordSave(failed)
  })

  it('refuses to continue when a record cannot deliver its queued edits', async () => {
    const unregister = registerRecordFlusher(async () => {
      throw new Error('You are offline.')
    })
    await expect(flushRecordSaves()).rejects.toThrow('You are offline.')
    unregister()
    await expect(flushRecordSaves()).resolves.toBeUndefined()
  })
})
