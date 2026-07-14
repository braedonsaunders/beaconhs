import { describe, expect, it } from 'vitest'
import {
  inspectionStatusMilestonePatch,
  type InspectionRecordLifecycleState,
} from './inspection-record-lifecycle'

type InspectionRecord = InspectionRecordLifecycleState

function record(overrides: Partial<InspectionRecord> = {}): InspectionRecord {
  return {
    status: 'draft',
    locked: false,
    submittedAt: null,
    submittedByTenantUserId: null,
    closedAt: null,
    closedByTenantUserId: null,
    ...overrides,
  }
}

describe('inspection record lifecycle milestones', () => {
  const actor = '00000000-0000-4000-8000-000000000004'
  const originalSubmitter = '00000000-0000-4000-8000-000000000005'
  const now = new Date('2026-07-14T15:00:00.000Z')
  const submittedAt = new Date('2026-07-13T15:00:00.000Z')

  it('sets submit attribution once and does not lock a submitted record', () => {
    expect(inspectionStatusMilestonePatch(record(), 'submitted', actor, now)).toEqual({
      status: 'submitted',
      submittedAt: now,
      submittedByTenantUserId: actor,
      closedAt: null,
      closedByTenantUserId: null,
      locked: false,
    })
  })

  it('preserves original submission attribution while closing and locking', () => {
    expect(
      inspectionStatusMilestonePatch(
        record({
          status: 'submitted',
          submittedAt,
          submittedByTenantUserId: originalSubmitter,
        }),
        'closed',
        actor,
        now,
      ),
    ).toEqual({
      status: 'closed',
      submittedAt,
      submittedByTenantUserId: originalSubmitter,
      closedAt: now,
      closedByTenantUserId: actor,
      locked: true,
    })
  })

  it('reopens a closed record as submitted without fabricating a new submission', () => {
    expect(
      inspectionStatusMilestonePatch(
        record({
          status: 'closed',
          locked: true,
          submittedAt,
          submittedByTenantUserId: originalSubmitter,
          closedAt: now,
          closedByTenantUserId: actor,
        }),
        'submitted',
        actor,
        new Date('2026-07-14T16:00:00.000Z'),
      ),
    ).toEqual({
      status: 'submitted',
      submittedAt,
      submittedByTenantUserId: originalSubmitter,
      closedAt: null,
      closedByTenantUserId: null,
      locked: false,
    })
  })

  it('clears milestones and unlocks when returning to an editable state', () => {
    expect(
      inspectionStatusMilestonePatch(
        record({
          status: 'closed',
          locked: true,
          submittedAt,
          submittedByTenantUserId: originalSubmitter,
          closedAt: now,
          closedByTenantUserId: actor,
        }),
        'in_progress',
        actor,
        now,
      ),
    ).toEqual({
      status: 'in_progress',
      submittedAt: null,
      submittedByTenantUserId: null,
      closedAt: null,
      closedByTenantUserId: null,
      locked: false,
    })
  })

  it('is a true no-op for the current status', () => {
    expect(inspectionStatusMilestonePatch(record(), 'draft', actor, now)).toEqual({})
  })
})
