import { describe, expect, it } from 'vitest'
import { domainEventRetryAt } from './domain-event-outbox-policy'

describe('domain event outbox retry policy', () => {
  const now = new Date('2026-07-12T12:00:00.000Z')

  it('starts at fifteen seconds and doubles by attempt', () => {
    expect(domainEventRetryAt(1, now).toISOString()).toBe('2026-07-12T12:00:15.000Z')
    expect(domainEventRetryAt(2, now).toISOString()).toBe('2026-07-12T12:00:30.000Z')
    expect(domainEventRetryAt(3, now).toISOString()).toBe('2026-07-12T12:01:00.000Z')
  })

  it('caps retries at one hour without giving up on the event', () => {
    expect(domainEventRetryAt(100, now).toISOString()).toBe('2026-07-12T13:00:00.000Z')
  })

  it('handles malformed attempt counters conservatively', () => {
    expect(domainEventRetryAt(-10, now).toISOString()).toBe('2026-07-12T12:00:15.000Z')
    expect(domainEventRetryAt(Number.NaN, now).toISOString()).toBe('2026-07-12T12:00:15.000Z')
  })
})
