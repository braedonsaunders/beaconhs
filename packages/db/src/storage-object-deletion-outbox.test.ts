import { describe, expect, it } from 'vitest'
import {
  storageObjectDeletionError,
  storageObjectDeletionRetryAt,
} from './storage-object-deletion-outbox'

describe('storage object deletion outbox policy', () => {
  const now = new Date('2026-07-13T12:00:00.000Z')

  it('starts at fifteen seconds, doubles, and caps at one hour', () => {
    expect(storageObjectDeletionRetryAt(1, now).toISOString()).toBe('2026-07-13T12:00:15.000Z')
    expect(storageObjectDeletionRetryAt(2, now).toISOString()).toBe('2026-07-13T12:00:30.000Z')
    expect(storageObjectDeletionRetryAt(100, now).toISOString()).toBe('2026-07-13T13:00:00.000Z')
  })

  it('handles malformed attempts and bounds safe error text', () => {
    expect(storageObjectDeletionRetryAt(Number.NaN, now).toISOString()).toBe(
      '2026-07-13T12:00:15.000Z',
    )
    expect(storageObjectDeletionError(new Error(`unsafe\u0000${'x'.repeat(5_000)}`))).toBe(
      `unsafe ${'x'.repeat(3_993)}`,
    )
    expect(storageObjectDeletionError('plain failure')).toBe('plain failure')
  })
})
