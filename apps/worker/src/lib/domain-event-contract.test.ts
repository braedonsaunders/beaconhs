import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { signDomainEventRequest, verifyDomainEventRequest } from '@beaconhs/events/internal-auth'
import { assertDomainEventIdentity } from '@beaconhs/events/outbox'

describe('domain event contract', () => {
  const originalSecret = process.env.BETTER_AUTH_SECRET

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = 'domain-event-test-secret-with-sufficient-entropy'
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET
    else process.env.BETTER_AUTH_SECRET = originalSecret
  })

  it('authenticates a fresh worker-to-web request and rejects tampering or replay', () => {
    const eventId = '10000000-0000-4000-8000-000000000001'
    const now = new Date('2026-07-12T12:00:00.000Z')
    const timestamp = String(now.getTime())
    const signature = signDomainEventRequest(eventId, timestamp)

    expect(verifyDomainEventRequest(eventId, timestamp, signature, now)).toBe(true)
    expect(verifyDomainEventRequest(`${eventId}x`, timestamp, signature, now)).toBe(false)
    expect(
      verifyDomainEventRequest(eventId, String(now.getTime() - 6 * 60_000), signature, now),
    ).toBe(false)
  })

  it('rejects cross-tenant or cross-subject effect payloads', () => {
    const base = {
      tenantId: '10000000-0000-4000-8000-000000000001',
      eventType: 'incident.created',
      subjectId: '20000000-0000-4000-8000-000000000001',
      dedupKey: 'incident.created:one',
    }
    expect(() =>
      assertDomainEventIdentity({
        ...base,
        payload: {
          integration: {
            type: 'incident.created',
            tenantId: '10000000-0000-4000-8000-000000000002',
            subjectId: base.subjectId,
            items: [],
          },
        },
      }),
    ).toThrow(/identity/)
    expect(() =>
      assertDomainEventIdentity({
        ...base,
        payload: {
          notification: {
            kind: 'incident_reported',
            incidentId: '20000000-0000-4000-8000-000000000002',
          },
        },
      }),
    ).toThrow(/identity/)
  })
})
