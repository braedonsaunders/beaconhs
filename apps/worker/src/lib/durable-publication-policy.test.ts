import { describe, expect, it } from 'vitest'
import {
  durablePublicationError,
  durablePublicationRepublishAt,
  durablePublicationRetryAt,
  durablePublicationStaleBefore,
} from './durable-publication-policy'

describe('durable publication policy', () => {
  const now = new Date('2026-07-13T12:00:00.000Z')

  it('backs failed rows off exponentially without ever abandoning them', () => {
    expect(durablePublicationRetryAt(1, now).toISOString()).toBe('2026-07-13T12:00:15.000Z')
    expect(durablePublicationRetryAt(2, now).toISOString()).toBe('2026-07-13T12:00:30.000Z')
    expect(durablePublicationRetryAt(100, now).toISOString()).toBe('2026-07-13T13:00:00.000Z')
    expect(durablePublicationRetryAt(Number.NaN, now).toISOString()).toBe(
      '2026-07-13T12:00:15.000Z',
    )
  })

  it('reclaims abandoned leases and periodically reasserts queued report jobs', () => {
    expect(durablePublicationStaleBefore(now).toISOString()).toBe('2026-07-13T11:45:00.000Z')
    expect(durablePublicationRepublishAt(now).toISOString()).toBe('2026-07-13T12:15:00.000Z')
  })

  it('rejects invalid clocks and stores bounded single-line errors', () => {
    expect(() => durablePublicationStaleBefore(new Date(Number.NaN))).toThrow('valid date')
    expect(() => durablePublicationRetryAt(1, new Date(Number.NaN))).toThrow('valid date')
    expect(
      durablePublicationError(new Error(` unsafe\n\u0000${'x'.repeat(5_000)}`), 'fallback'),
    ).toBe(`unsafe ${'x'.repeat(3_993)}`)
    expect(durablePublicationError('', 'Publication failed')).toBe('Publication failed')
  })
})
