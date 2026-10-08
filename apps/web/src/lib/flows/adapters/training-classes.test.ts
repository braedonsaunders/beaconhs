import { describe, expect, it, vi } from 'vitest'
import type { RequestContext } from '@beaconhs/tenant'
vi.mock('server-only', () => ({}))
import { createTrainingClassFlowAdapter } from './training-classes'

function context(location: string | null, notes: string | null, startsAt: string, endsAt: string) {
  return {
    tenantId: 'tenant',
    timezone: 'America/Toronto',
    db: vi
      .fn()
      .mockResolvedValueOnce([
        {
          c: {
            title: 'Crane class',
            startsAt: new Date(startsAt),
            endsAt: new Date(endsAt),
            location,
            notes,
            completedAt: null,
            cancelledAt: null,
          },
          siteName: 'Saved site',
          courseDescription: 'Course description',
        },
      ])
      .mockResolvedValueOnce([]),
  } as unknown as RequestContext
}

describe('training class print and flow values', () => {
  it('uses the class page timezone and free-text location, hiding imported null notes', async () => {
    const ctx = context(
      'North Conference Room',
      'null',
      '2026-10-30T11:30:00Z',
      '2026-10-30T16:00:00Z',
    )
    const adapter = createTrainingClassFlowAdapter(ctx, 'class')
    const values = await adapter.loadValues()
    expect(values.starts_at).toBe('Oct 30, 2026, 7:30 AM')
    expect(values.ends_at).toBe('Oct 30, 2026, 12:00 PM')
    expect(values.site_name).toBe('North Conference Room')
    expect(values).not.toHaveProperty('course_description')
    expect(values.notes).toBe('')
    const job = adapter.pdfJob!(values)
    if (!job) throw new Error('Expected a printable class summary')
    expect(job.kind).toBe('record_summary')
    if (job.kind === 'record_summary')
      expect(job.fields.some((field) => field.label === 'Course Description')).toBe(false)
  })

  it('keeps cancelled bookings out of the emailed table, count and recipients', async () => {
    const ctx = context(null, null, '2026-10-30T11:30:00Z', '2026-10-30T16:00:00Z')
    vi.mocked(ctx.db)
      .mockReset()
      .mockResolvedValueOnce([
        {
          c: {
            title: 'First aid',
            startsAt: new Date('2026-10-30T11:30:00Z'),
            endsAt: new Date('2026-10-30T16:00:00Z'),
            cancelledAt: null,
            completedAt: null,
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          firstName: 'Matt',
          lastName: 'Wood',
          status: 'registered',
          personEmail: 'matt@example.com',
        },
        {
          firstName: 'Zack',
          lastName: 'Mann',
          status: 'registered',
          personEmail: null,
          userEmail: 'zack@example.com',
        },
        {
          firstName: 'Cancelled',
          lastName: 'Person',
          status: 'cancelled',
          personEmail: 'cancelled@example.com',
        },
      ])
    const values = await createTrainingClassFlowAdapter(ctx, 'class').loadValues()
    expect(values.attendee_count).toBe(2)
    expect(values.attendee_emails).toBe('matt@example.com, zack@example.com')
    expect(values.attendees).toEqual([
      { name: 'Matt Wood', email: 'matt@example.com', status: 'Registered' },
      { name: 'Zack Mann', email: 'zack@example.com', status: 'Registered' },
    ])
  })

  it('falls back to the saved site and observes winter offsets', async () => {
    const adapter = createTrainingClassFlowAdapter(
      context(null, 'Bring PPE', '2026-12-01T13:30:00Z', '2026-12-01T19:00:00Z'),
      'class',
    )
    const values = await adapter.loadValues()
    expect(values.starts_at).toBe('Dec 1, 2026, 8:30 AM')
    expect(values.ends_at).toBe('Dec 1, 2026, 2:00 PM')
    expect(values.site_name).toBe('Saved site')
    expect(values.notes).toBe('Bring PPE')
  })
})
