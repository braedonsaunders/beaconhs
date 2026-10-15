import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  recordAuditInTransaction: vi.fn(async () => undefined),
  lockRecord: vi.fn(),
  lockCriterion: vi.fn(),
  markInProgress: vi.fn(async () => false),
  syncHours: vi.fn(async () => undefined),
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/audit', () => ({ recordAuditInTransaction: mocks.recordAuditInTransaction }))
vi.mock('./_lib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./_lib')>()),
  lockVisibleEquipmentInspection: mocks.lockRecord,
  lockEquipmentInspectionCriterionForMutation: mocks.lockCriterion,
  markEquipmentInspectionInProgressIfDraft: mocks.markInProgress,
  syncInspectionHoursInTx: mocks.syncHours,
}))

import type { Database } from '@beaconhs/db'
import type {
  equipmentInspectionRecordCriteria,
  equipmentInspectionRecords,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { criterionFieldId } from '@/components/inspection/criterion-fields'
import { equipmentInspectionRecordSaver, parseHoursReading } from './_record-edits'

type RecordRow = typeof equipmentInspectionRecords.$inferSelect
type CriterionRow = typeof equipmentInspectionRecordCriteria.$inferSelect

const RECORD_ID = '5b0f3c3e-2f7a-4d6e-9a51-0c6f4c1b2d3e'
const ROW_ID = '0d4e8a1f-6c2b-4b7a-8f3e-9a1c2d3e4f50'
const ITEM_ID = '7e2a9c4b-1d3f-4a6e-b8c0-2f4e6a8c0b1d'
const field = (name: string) => criterionFieldId(ROW_ID, name)

function record(overrides: Partial<RecordRow> = {}): RecordRow {
  return {
    id: RECORD_ID,
    tenantId: 'tenant-1',
    equipmentItemId: ITEM_ID,
    status: 'draft',
    locked: false,
    occurredAt: new Date('2026-10-14T12:00:00Z'),
    siteOrgUnitId: null,
    hours: null,
    notes: null,
    ...overrides,
  } as RecordRow
}

function criterion(overrides: Partial<CriterionRow> = {}): CriterionRow {
  return {
    id: ROW_ID,
    tenantId: 'tenant-1',
    recordId: RECORD_ID,
    questionTextSnapshot: 'Hydraulic hoses',
    kind: 'pass_fail',
    answer: null,
    numericValue: null,
    textValue: null,
    severity: null,
    comment: null,
    actionTaken: null,
    correctedOn: null,
    photoAttachmentIds: [],
    ...overrides,
  } as CriterionRow
}

function harness(row: RecordRow, criterionRow: CriterionRow | null) {
  const writes: Array<Record<string, unknown>> = []
  const tx = {
    execute: async () => undefined,
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        writes.push(patch)
        return { where: () => ({ returning: async () => [{ id: 'updated' }] }) }
      },
    }),
  } as unknown as Database
  const ctx = {
    tenantId: 'tenant-1',
    timezone: 'America/Toronto',
    membership: { id: 'member-1' },
    isSuperAdmin: false,
    permissions: new Set(['equipment.inspect']),
    db: <T>(fn: (db: Database) => Promise<T>) => fn(tx),
  } as unknown as RequestContext
  mocks.lockRecord.mockImplementation(async () => row)
  mocks.lockCriterion.mockImplementation(async () => criterionRow)
  return { ctx, writes }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('equipment inspection record saver', () => {
  it('passes a failed item and acknowledges the finding clears the card queued', async () => {
    const row = criterion({
      answer: 'fail',
      severity: 'high',
      comment: 'Leaking',
      actionTaken: 'Tagged',
    })
    const { ctx, writes } = harness(record(), row)
    const result = await equipmentInspectionRecordSaver(ctx, RECORD_ID, [
      { fieldId: field('answer'), value: 'pass', base: 'fail' },
      { fieldId: field('comment'), value: '', base: 'Leaking' },
      { fieldId: field('actionTaken'), value: '', base: 'Tagged' },
    ])
    expect(result).toMatchObject({ ok: true, conflicts: [], rejected: [] })
    expect(writes).toEqual([
      expect.objectContaining({
        answer: 'pass',
        comment: null,
        actionTaken: null,
        correctedOn: null,
      }),
    ])
    expect(mocks.recordAuditInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      expect.objectContaining({
        entityType: 'equipment_inspection_record',
        summary: 'Answered inspection item "pass"',
      }),
    )
    expect(mocks.markInProgress).toHaveBeenCalledTimes(1)
    expect(mocks.syncHours).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/equipment/${ITEM_ID}`)
  })

  it('keeps finding fields to failed items and N/A to items that allow it', async () => {
    const { ctx, writes } = harness(record(), criterion({ answer: 'pass' }))
    const result = await equipmentInspectionRecordSaver(ctx, RECORD_ID, [
      { fieldId: field('severity'), value: 'low', base: '' },
      { fieldId: field('comment'), value: 'Worn', base: '' },
      { fieldId: field('answer'), value: 'n_a', base: 'pass' },
    ])
    expect(result).toMatchObject({
      applied: [],
      rejected: [
        {
          fieldId: field('severity'),
          error: 'Severity can only be set on a failed inspection item',
        },
        { fieldId: field('comment'), error: 'Comment can only be set on a failed inspection item' },
        { fieldId: field('answer'), error: 'N/A is not allowed for this inspection item' },
      ],
    })
    expect(writes).toEqual([])
  })

  it('takes the value kind from the snapshot row', async () => {
    const numeric = harness(record(), criterion({ kind: 'numeric' }))
    expect(
      await equipmentInspectionRecordSaver(numeric.ctx, RECORD_ID, [
        { fieldId: field('value'), value: '42.50', base: '' },
      ]),
    ).toMatchObject({ applied: [{ fieldId: field('value'), stored: '42.5' }] })
    expect(numeric.writes).toEqual([
      expect.objectContaining({ numericValue: '42.50', textValue: null }),
    ])

    const photo = harness(record(), criterion({ kind: 'photo' }))
    expect(
      await equipmentInspectionRecordSaver(photo.ctx, RECORD_ID, [
        { fieldId: field('value'), value: 'x', base: '' },
      ]),
    ).toMatchObject({
      rejected: [{ fieldId: field('value'), error: 'This field can no longer be edited.' }],
    })
  })

  it('stores the hour reading to one decimal and moves the unit meter once', async () => {
    const row = record()
    const { ctx, writes } = harness(row, null)
    const result = await equipmentInspectionRecordSaver(ctx, RECORD_ID, [
      { fieldId: 'hours', value: '1250', base: '' },
      { fieldId: 'occurredAt', value: '2026-10-14T07:15', base: '2026-10-14T08:00' },
    ])
    expect(result).toMatchObject({
      applied: [
        { fieldId: 'hours', stored: '1250.0' },
        { fieldId: 'occurredAt', stored: '2026-10-14T07:15' },
      ],
    })
    expect(writes).toEqual([{ hours: '1250.0' }, { occurredAt: new Date('2026-10-14T11:15:00Z') }])
    expect(mocks.syncHours).toHaveBeenCalledTimes(1)
    expect(mocks.syncHours).toHaveBeenCalledWith(expect.anything(), ctx, row)
    expect(row).toMatchObject({ hours: '1250.0', occurredAt: new Date('2026-10-14T11:15:00Z') })
  })

  it('validates hour readings like the old meter field', () => {
    expect(parseHoursReading('')).toBeNull()
    expect(parseHoursReading('12.5')).toBe('12.5')
    expect(() => parseHoursReading('12.55')).toThrow('Hours reading has too many decimal places.')
    expect(() => parseHoursReading('-1')).toThrow('Hours reading is outside the allowed range.')
  })

  it('holds edits while the inspection is submitted, closed, or locked', async () => {
    for (const row of [
      record({ status: 'submitted' }),
      record({ status: 'closed' }),
      record({ locked: true }),
    ]) {
      const { ctx, writes } = harness(row, criterion())
      expect(
        await equipmentInspectionRecordSaver(ctx, RECORD_ID, [
          { fieldId: 'notes', value: 'x', base: '' },
        ]),
      ).toEqual({
        ok: false,
        reason: 'locked',
        error: 'This equipment inspection is submitted or locked',
      })
      expect(writes).toEqual([])
    }
  })
})
