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
    const ctx = context('Shop classroom', 'null', '2026-10-30T11:30:00Z', '2026-10-30T18:00:00Z')
    const adapter = createTrainingClassFlowAdapter(ctx, 'class')
    const values = await adapter.loadValues()
    expect(values.starts_at).toBe('2026-10-30 07:30')
    expect(values.ends_at).toBe('2026-10-30 14:00')
    expect(values.site_name).toBe('Shop classroom')
    expect(values.notes).toBe('')
    const job = adapter.pdfJob!(values)
    if (!job) throw new Error('Expected a printable class summary')
    expect(job.kind).toBe('record_summary')
    if (job.kind === 'record_summary')
      expect(job.fields.some((field) => field.label === 'Course Description')).toBe(false)
  })

  it('falls back to the saved site and observes winter offsets', async () => {
    const adapter = createTrainingClassFlowAdapter(
      context(null, 'Bring PPE', '2026-12-01T13:30:00Z', '2026-12-01T19:00:00Z'),
      'class',
    )
    const values = await adapter.loadValues()
    expect(values.starts_at).toBe('2026-12-01 08:30')
    expect(values.ends_at).toBe('2026-12-01 14:00')
    expect(values.site_name).toBe('Saved site')
    expect(values.notes).toBe('Bring PPE')
  })
})
