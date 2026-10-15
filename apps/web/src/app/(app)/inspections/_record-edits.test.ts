import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  canSeeRecord: vi.fn(async () => true),
  materialize: vi.fn(async () => undefined),
  recordAuditInTransaction: vi.fn(async () => undefined),
  lockRecord: vi.fn(),
  lockCriterion: vi.fn(),
  markInProgress: vi.fn(async () => false),
  reconcile: vi.fn(async () => false),
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@beaconhs/tenant/visibility', () => ({ canSeeRecord: mocks.canSeeRecord }))
vi.mock('@beaconhs/compliance', () => ({
  materializeEvidenceTargetObligations: mocks.materialize,
}))
vi.mock('@/lib/audit', () => ({ recordAuditInTransaction: mocks.recordAuditInTransaction }))
vi.mock('./_lib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./_lib')>()),
  lockVisibleInspectionRecord: mocks.lockRecord,
  lockInspectionCriterionForMutation: mocks.lockCriterion,
  markInspectionInProgressIfDraft: mocks.markInProgress,
  reconcileSubmittedInspectionInTx: mocks.reconcile,
}))

import type { Database } from '@beaconhs/db'
import type { inspectionRecordCriteria, inspectionRecords } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { criterionFieldId } from '@/components/inspection/criterion-fields'
import { inspectionRecordSaver } from './_record-edits'

type RecordRow = typeof inspectionRecords.$inferSelect
type CriterionRow = typeof inspectionRecordCriteria.$inferSelect

const RECORD_ID = '5b0f3c3e-2f7a-4d6e-9a51-0c6f4c1b2d3e'
const ROW_ID = '0d4e8a1f-6c2b-4b7a-8f3e-9a1c2d3e4f50'
const PERSON_ID = '7e2a9c4b-1d3f-4a6e-b8c0-2f4e6a8c0b1d'
const field = (name: string) => criterionFieldId(ROW_ID, name)

function record(overrides: Partial<RecordRow> = {}): RecordRow {
  return {
    id: RECORD_ID,
    tenantId: 'tenant-1',
    typeId: 'type-1',
    status: 'in_progress',
    locked: false,
    occurredAt: new Date('2026-10-14T12:00:00Z'),
    siteOrgUnitId: null,
    locationOnSite: null,
    supervisorTenantUserId: null,
    foremanText: null,
    notes: null,
    ...overrides,
  } as RecordRow
}

function criterion(overrides: Partial<CriterionRow> = {}): CriterionRow {
  return {
    id: ROW_ID,
    tenantId: 'tenant-1',
    recordId: RECORD_ID,
    questionTextSnapshot: 'Guard rails in place',
    responseType: 'pass_fail_na',
    choiceOptionsSnapshot: [],
    answer: null,
    choiceAnswer: null,
    textAnswer: null,
    numberAnswer: null,
    severity: null,
    nonComplianceDescription: null,
    actionTaken: null,
    compliantNote: null,
    assignedToPersonId: null,
    assignedToTenantUserId: null,
    assignedDueDate: null,
    correctedOn: null,
    correctiveActionId: null,
    photoAttachmentIds: [],
    ...overrides,
  } as CriterionRow
}

/** Records every UPDATE's patch; the criterion/record rows come from the mocked locks. */
function harness(row: RecordRow, criterionRow: CriterionRow | null) {
  const writes: Array<Record<string, unknown>> = []
  const done = { then: (resolve: (value: unknown) => unknown) => resolve(undefined) }
  const tx = {
    execute: async () => undefined,
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        writes.push(patch)
        return {
          where: () => ({ ...done, returning: async () => [{ id: 'updated' }] }),
        }
      },
    }),
  } as unknown as Database
  const ctx = {
    tenantId: 'tenant-1',
    timezone: 'America/Toronto',
    membership: { id: 'member-1' },
    isSuperAdmin: false,
    permissions: new Set(['inspections.update']),
    db: <T>(fn: (db: Database) => Promise<T>) => fn(tx),
  } as unknown as RequestContext
  mocks.lockRecord.mockImplementation(async () => row)
  mocks.lockCriterion.mockImplementation(async () => criterionRow)
  return { ctx, writes }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.markInProgress.mockImplementation(async () => false)
})

describe('inspection record saver — criterion answers and findings', () => {
  it('passes a failed criterion and acknowledges the finding clears the card queued', async () => {
    const row = criterion({
      answer: 'fail',
      severity: 'high',
      nonComplianceDescription: 'Frayed lanyard',
      assignedToPersonId: PERSON_ID,
      assignedToTenantUserId: 'member-2',
      assignedDueDate: '2026-10-20',
      correctedOn: '2026-10-13',
    })
    const { ctx, writes } = harness(record(), row)
    const result = await inspectionRecordSaver(ctx, RECORD_ID, [
      { fieldId: field('answer'), value: 'pass', base: 'fail' },
      { fieldId: field('severity'), value: '', base: 'high' },
      { fieldId: field('nonCompliance'), value: '', base: 'Frayed lanyard' },
      {
        fieldId: field('assignment'),
        value: { assignedToPersonId: '', assignedDueDate: '' },
        base: { assignedToPersonId: PERSON_ID, assignedDueDate: '2026-10-20' },
      },
      { fieldId: field('correctedOn'), value: '', base: '2026-10-13' },
    ])
    expect(result).toMatchObject({ ok: true, conflicts: [], rejected: [] })
    expect(result.ok && result.applied.map((entry) => entry.fieldId)).toEqual([
      field('answer'),
      field('severity'),
      field('nonCompliance'),
      field('assignment'),
      field('correctedOn'),
    ])
    // One write: the answer, which clears the whole finding on the server.
    expect(writes).toEqual([
      expect.objectContaining({
        answer: 'pass',
        severity: null,
        nonComplianceDescription: null,
        actionTaken: null,
        assignedToPersonId: null,
        assignedToTenantUserId: null,
        assignedDueDate: null,
        correctedOn: null,
        answeredByTenantUserId: 'member-1',
      }),
    ])
    expect(mocks.recordAuditInTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.recordAuditInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      expect.objectContaining({
        entityType: 'inspection_record',
        entityId: RECORD_ID,
        summary: 'Answered "Guard rails in place" — pass',
      }),
    )
    expect(mocks.markInProgress).toHaveBeenCalledTimes(1)
    expect(mocks.reconcile).toHaveBeenCalledTimes(1)
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/inspections/records/${RECORD_ID}`)
  })

  it('never conflicts when the clears arrive before the answer', async () => {
    const { ctx, writes } = harness(
      record(),
      criterion({ answer: 'fail', severity: 'low', nonComplianceDescription: 'Loose' }),
    )
    const result = await inspectionRecordSaver(ctx, RECORD_ID, [
      { fieldId: field('severity'), value: '', base: 'low' },
      { fieldId: field('nonCompliance'), value: '', base: 'Loose' },
      { fieldId: field('answer'), value: 'n_a', base: 'fail' },
    ])
    expect(result).toMatchObject({ ok: true, conflicts: [], rejected: [] })
    expect(writes).toEqual([
      { severity: null },
      { nonComplianceDescription: null },
      expect.objectContaining({ answer: 'n_a', severity: null }),
    ])
  })

  it('applies a new fail and its finding in one batch, in edit order', async () => {
    const row = criterion()
    const { ctx, writes } = harness(record({ status: 'draft' }), row)
    mocks.markInProgress.mockImplementation(async () => true)
    const result = await inspectionRecordSaver(ctx, RECORD_ID, [
      { fieldId: field('answer'), value: 'fail', base: '' },
      { fieldId: field('severity'), value: 'critical', base: '' },
      { fieldId: field('nonCompliance'), value: '  No toe boards ', base: '' },
    ])
    expect(result).toMatchObject({
      ok: true,
      applied: [
        { fieldId: field('answer'), stored: 'fail' },
        { fieldId: field('severity'), stored: 'critical' },
        { fieldId: field('nonCompliance'), stored: 'No toe boards' },
      ],
    })
    expect(writes).toHaveLength(3)
    expect(row).toMatchObject({
      answer: 'fail',
      severity: 'critical',
      nonComplianceDescription: 'No toe boards',
    })
    expect(mocks.recordAuditInTransaction).toHaveBeenCalledTimes(3)
  })

  it('refuses finding fields on a criterion that did not fail', async () => {
    const { ctx, writes } = harness(record(), criterion({ answer: 'pass' }))
    const result = await inspectionRecordSaver(ctx, RECORD_ID, [
      { fieldId: field('severity'), value: 'high', base: '' },
      { fieldId: field('actionTaken'), value: 'Replaced', base: '' },
      { fieldId: field('compliantNote'), value: 'All good', base: '' },
    ])
    expect(result).toMatchObject({
      ok: true,
      applied: [{ fieldId: field('compliantNote'), stored: 'All good' }],
      rejected: [
        { fieldId: field('severity'), error: 'Severity applies only to a failed criterion' },
        {
          fieldId: field('actionTaken'),
          error: 'An action taken applies only to a failed criterion',
        },
      ],
    })
    expect(writes).toEqual([{ compliantNote: 'All good' }])
  })

  it('acknowledges a retried answer and reports a changed one as a conflict', async () => {
    const retried = harness(record(), criterion({ answer: 'pass' }))
    expect(
      await inspectionRecordSaver(retried.ctx, RECORD_ID, [
        { fieldId: field('answer'), value: 'pass', base: 'fail' },
      ]),
    ).toMatchObject({ ok: true, applied: [{ fieldId: field('answer'), stored: 'pass' }] })
    expect(retried.writes).toEqual([])
    expect(mocks.recordAuditInTransaction).not.toHaveBeenCalled()

    const changed = harness(record(), criterion({ answer: 'n_a' }))
    expect(
      await inspectionRecordSaver(changed.ctx, RECORD_ID, [
        { fieldId: field('answer'), value: 'pass', base: 'fail' },
      ]),
    ).toMatchObject({ ok: true, conflicts: [{ fieldId: field('answer'), current: 'n_a' }] })
    expect(changed.writes).toEqual([])
  })

  it('compares number answers in their canonical spelling', async () => {
    const row = criterion({ responseType: 'number' })
    const { ctx, writes } = harness(record(), row)
    expect(
      await inspectionRecordSaver(ctx, RECORD_ID, [
        { fieldId: field('value'), value: '1e3', base: '' },
      ]),
    ).toMatchObject({ applied: [{ fieldId: field('value'), stored: '1000' }] })
    expect(writes).toEqual([expect.objectContaining({ numberAnswer: '1e3', textAnswer: null })])

    // PostgreSQL hands the value back as 1000: the retry is acknowledged.
    row.numberAnswer = '1000'
    expect(
      await inspectionRecordSaver(ctx, RECORD_ID, [
        { fieldId: field('value'), value: '1e3', base: '' },
      ]),
    ).toMatchObject({ applied: [{ fieldId: field('value'), stored: '1000' }], conflicts: [] })
    expect(writes).toHaveLength(1)
  })

  it('accepts only configured choices and refuses ops for another response type', async () => {
    const { ctx, writes } = harness(
      record(),
      criterion({ responseType: 'choice', choiceOptionsSnapshot: ['Safe', 'Unsafe'] }),
    )
    const result = await inspectionRecordSaver(ctx, RECORD_ID, [
      { fieldId: field('choiceAnswer'), value: 'Maybe', base: '' },
      { fieldId: field('answer'), value: 'pass', base: '' },
    ])
    expect(result).toMatchObject({
      rejected: [
        { fieldId: field('choiceAnswer'), error: 'Select one of the configured options' },
        { fieldId: field('answer'), error: 'This field can no longer be edited.' },
      ],
    })
    expect(writes).toEqual([])
  })

  it('refuses a criterion row that is not on this record', async () => {
    const { ctx } = harness(record(), null)
    expect(
      await inspectionRecordSaver(ctx, RECORD_ID, [
        { fieldId: field('answer'), value: 'pass', base: '' },
      ]),
    ).toMatchObject({
      ok: true,
      rejected: [{ fieldId: field('answer'), error: 'This field can no longer be edited.' }],
    })
  })
})

describe('inspection record saver — record fields and lifecycle', () => {
  it('reads occurred-at as wall-clock time in the worker’s timezone and re-materializes', async () => {
    const row = record()
    const { ctx, writes } = harness(row, null)
    const result = await inspectionRecordSaver(ctx, RECORD_ID, [
      { fieldId: 'occurredAt', value: '2026-10-14T08:30', base: '2026-10-14T08:00' },
    ])
    expect(result).toMatchObject({
      applied: [{ fieldId: 'occurredAt', stored: '2026-10-14T08:30' }],
    })
    expect(writes).toEqual([{ occurredAt: new Date('2026-10-14T12:30:00Z') }])
    expect(mocks.materialize).toHaveBeenCalledWith(expect.anything(), 'tenant-1', {
      sourceModule: 'inspection',
      targetRef: { inspectionTypeId: 'type-1' },
    })
    expect(mocks.recordAuditInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      expect.objectContaining({
        summary: 'Updated occurredAt',
        before: { occurredAt: new Date('2026-10-14T12:00:00Z') },
        after: { occurredAt: new Date('2026-10-14T12:30:00Z') },
      }),
    )
    // Record fields never reconcile criteria or start the work.
    expect(mocks.reconcile).not.toHaveBeenCalled()
    expect(mocks.markInProgress).not.toHaveBeenCalled()
  })

  it('trims text fields and does not re-materialize for them', async () => {
    const { ctx, writes } = harness(record({ notes: 'Old' }), null)
    expect(
      await inspectionRecordSaver(ctx, RECORD_ID, [
        { fieldId: 'notes', value: '  Wet deck  ', base: 'Old' },
        { fieldId: 'foremanText', value: '   ', base: '' },
      ]),
    ).toMatchObject({
      applied: [
        { fieldId: 'notes', stored: 'Wet deck' },
        { fieldId: 'foremanText', stored: '' },
      ],
    })
    expect(writes).toEqual([{ notes: 'Wet deck' }])
    expect(mocks.materialize).not.toHaveBeenCalled()
  })

  it('holds edits for a locked or closed record, and drops nothing', async () => {
    for (const row of [record({ locked: true }), record({ status: 'closed' })]) {
      const { ctx, writes } = harness(row, criterion())
      expect(
        await inspectionRecordSaver(ctx, RECORD_ID, [
          { fieldId: field('answer'), value: 'pass', base: '' },
        ]),
      ).toEqual({
        ok: false,
        reason: 'locked',
        error: 'Record is closed or locked. Reopen or unlock it before making changes.',
      })
      expect(writes).toEqual([])
    }
  })

  it('reports a missing or hidden record as not found', async () => {
    const { ctx } = harness(record(), null)
    mocks.lockRecord.mockImplementation(async () => null)
    expect(
      await inspectionRecordSaver(ctx, RECORD_ID, [{ fieldId: 'notes', value: 'x', base: '' }]),
    ).toMatchObject({ ok: false, reason: 'not_found' })
  })
})
