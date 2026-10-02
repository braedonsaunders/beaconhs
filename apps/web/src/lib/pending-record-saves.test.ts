// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  FLUSH_RECORD_SAVES,
  trackRecordSave,
  flushRecordSaves,
  forgetRecordSave,
} from './pending-record-saves'

describe('record submission save barrier', () => {
  it('flushes a focused editor and waits for its upload and attachment writes', async () => {
    let release!: () => void
    let linked = false
    const key = Symbol()
    const handler = () => {
      void trackRecordSave(
        key,
        new Promise<void>((resolve) => {
          release = () => {
            linked = true
            resolve()
          }
        }),
      )
    }
    window.addEventListener(FLUSH_RECORD_SAVES, handler, { once: true })
    const flush = flushRecordSaves()
    expect(linked).toBe(false)
    release()
    await flush
    expect(linked).toBe(true)
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
})
