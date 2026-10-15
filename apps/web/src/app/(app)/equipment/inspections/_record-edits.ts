// The `equipment-inspections` record saver: inline edits in the inspection
// flyout — when and where it was performed, the hour-meter reading, notes, and
// every checklist answer and finding — queued on the device and applied by
// /api/records/sync (see lib/record-sync). Same rules the flyout's autosave has
// always had: the `equipment.inspect` permission, record visibility,
// submitted / closed / locked records are read-only until reopened, checklist
// rows must belong to the record, the answer kind comes from the row's
// snapshot, finding fields apply only to a failed item, and a non-fail answer
// clears the finding text. Every write audits in the same transaction, any
// change starts a draft, and a new reading or date updates the unit's meter.
//
// Checklist fields are `criteria:<rowId>:<field>`. A non-fail answer clears
// the comment and action taken on the server; the card queues the same clears
// on the device, so a batch never sends finding text to an item that passed.

import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  equipmentInspectionRecordCriteria,
  equipmentInspectionRecords,
  orgUnits,
} from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import { recordAuditInTransaction } from '@/lib/audit'
import { datetimeLocalValue, parseDatetimeLocal } from '@/lib/datetime'
import {
  inspectionNumberAnswerWire,
  normalizeInspectionTextAnswer,
  parseInspectionNumberAnswer,
} from '@/lib/inspection-response-config'
import { optionalNumberInput } from '@/lib/mutation-input'
import { optionalRef } from '@/lib/record-sync/codecs'
import {
  defineRecordSaver,
  RecordEditRejection,
  recordLocked,
  recordNotFound,
  recordOp,
  type ErasedRecordOp,
} from '@/lib/record-sync/edits'
import { parseCriterionFieldId } from '@/components/inspection/criterion-fields'
import {
  EQUIPMENT_INSPECTION_FINALIZED_MESSAGE,
  equipmentInspectionIsFinalized,
  lockEquipmentInspectionCriterionForMutation,
  lockVisibleEquipmentInspection,
  markEquipmentInspectionInProgressIfDraft,
  parseEqAnswer,
  parseEqSeverity,
  syncInspectionHoursInTx,
} from './_lib'

type RecordRow = typeof equipmentInspectionRecords.$inferSelect
type CriterionRow = typeof equipmentInspectionRecordCriteria.$inferSelect
type EqAnswer = NonNullable<CriterionRow['answer']>
type EqSeverity = NonNullable<CriterionRow['severity']>

const EQUIPMENT_CRITERION_FIELDS = [
  'answer',
  'severity',
  'value',
  'comment',
  'actionTaken',
] as const
type EquipmentCriterionField = (typeof EQUIPMENT_CRITERION_FIELDS)[number]

type AuditEntry = {
  summary: string
  before: Record<string, unknown>
  after: Record<string, unknown>
}

type EquipmentInspectionEdits = {
  record: RecordRow
  /** Checklist rows of this record touched by the batch, locked on first use. */
  criteria: Map<string, CriterionRow>
  /** Audit entries for applied writes, in write order. */
  audits: AuditEntry[]
  /** The hour-meter reading or the performed date changed. */
  meterChanged: boolean
}

function wireText(wire: unknown, label: string): string {
  if (wire == null) return ''
  if (typeof wire === 'string') return wire
  throw new RecordEditRejection(`${label} is invalid.`)
}

/** An hour-meter reading: one decimal place, stored as `numeric` text. */
export function parseHoursReading(wire: unknown): string | null {
  const parsed = optionalNumberInput(wireText(wire, 'Hours reading'), 'Hours reading', {
    min: 0,
    max: 999999999.9,
    maxScale: 1,
  })
  return parsed === null ? null : parsed.toFixed(1)
}

function recordFieldOp(
  tx: Database,
  ctx: RequestContext,
  edits: EquipmentInspectionEdits,
  op: string,
): ErasedRecordOp | null {
  const { record } = edits
  const update = async <K extends 'occurredAt' | 'siteOrgUnitId' | 'hours' | 'notes'>(
    column: K,
    value: RecordRow[K],
    audit: AuditEntry,
  ) => {
    const [updated] = await tx
      .update(equipmentInspectionRecords)
      .set({ [column]: value })
      .where(
        and(
          eq(equipmentInspectionRecords.tenantId, ctx.tenantId),
          eq(equipmentInspectionRecords.id, record.id),
          isNull(equipmentInspectionRecords.deletedAt),
        ),
      )
      .returning({ id: equipmentInspectionRecords.id })
    if (!updated) throw new Error('Equipment inspection changed before it could be saved')
    record[column] = value
    edits.audits.push(audit)
  }

  switch (op) {
    case 'occurredAt':
      return recordOp<Date>({
        current: record.occurredAt,
        parse: (wire) => {
          const occurredAt = parseDatetimeLocal(wireText(wire, 'Performed'), ctx.timezone)
          if (!occurredAt) throw new RecordEditRejection('Inspection date and time is invalid')
          return occurredAt
        },
        format: (value) => datetimeLocalValue(value, ctx.timezone),
        write: async (occurredAt) => {
          await update('occurredAt', occurredAt, {
            summary: 'Updated inspection date and time',
            before: { occurredAt: record.occurredAt },
            after: { occurredAt },
          })
          edits.meterChanged = true
        },
      })
    case 'siteOrgUnitId': {
      const codec = optionalRef({ label: 'Location' })
      return recordOp<string | null>({
        current: record.siteOrgUnitId,
        parse: codec.parse,
        format: codec.format,
        write: async (siteOrgUnitId) => {
          if (siteOrgUnitId) {
            const [site] = await tx
              .select({ id: orgUnits.id })
              .from(orgUnits)
              .where(
                and(
                  eq(orgUnits.tenantId, ctx.tenantId),
                  eq(orgUnits.id, siteOrgUnitId),
                  isNull(orgUnits.deletedAt),
                ),
              )
              .limit(1)
            if (!site) throw new RecordEditRejection('Location not found.')
          }
          await update('siteOrgUnitId', siteOrgUnitId, {
            summary: 'Updated inspection location',
            before: { siteOrgUnitId: record.siteOrgUnitId },
            after: { siteOrgUnitId },
          })
        },
      })
    }
    case 'hours':
      return recordOp<string | null>({
        current: record.hours,
        parse: parseHoursReading,
        format: (value) => value ?? '',
        write: async (hours) => {
          await update('hours', hours, {
            summary: hours == null ? 'Cleared hours reading' : 'Updated hours reading',
            before: { hours: record.hours },
            after: { hours },
          })
          edits.meterChanged = true
        },
      })
    case 'notes':
      return recordOp<string | null>({
        current: record.notes,
        parse: (wire) => normalizeInspectionTextAnswer(wireText(wire, 'Notes')),
        format: (value) => value ?? '',
        write: (notes) =>
          update('notes', notes, {
            summary: notes ? 'Updated inspection notes' : 'Cleared inspection notes',
            before: { notes: record.notes },
            after: { notes },
          }),
      })
    default:
      return null
  }
}

async function criterionForEdit(
  tx: Database,
  ctx: RequestContext,
  edits: EquipmentInspectionEdits,
  rowId: string,
): Promise<CriterionRow | null> {
  const cached = edits.criteria.get(rowId)
  if (cached) return cached
  const criterion = await lockEquipmentInspectionCriterionForMutation(
    tx,
    ctx.tenantId,
    edits.record.id,
    rowId,
  )
  if (criterion) edits.criteria.set(rowId, criterion)
  return criterion
}

function criterionFieldOp(
  tx: Database,
  ctx: RequestContext,
  edits: EquipmentInspectionEdits,
  criterion: CriterionRow,
  field: EquipmentCriterionField,
): ErasedRecordOp | null {
  const rowId = criterion.id
  const save = async (patch: Partial<CriterionRow>, audit: AuditEntry) => {
    const [updated] = await tx
      .update(equipmentInspectionRecordCriteria)
      .set(patch)
      .where(
        and(
          eq(equipmentInspectionRecordCriteria.tenantId, ctx.tenantId),
          eq(equipmentInspectionRecordCriteria.recordId, criterion.recordId),
          eq(equipmentInspectionRecordCriteria.id, rowId),
        ),
      )
      .returning({ id: equipmentInspectionRecordCriteria.id })
    if (!updated) throw new Error('Inspection item changed before it could be saved')
    Object.assign(criterion, patch)
    edits.audits.push(audit)
  }
  /** Finding fields belong to a failed item only. */
  const requireFail = (message: string) => {
    if (criterion.answer !== 'fail') throw new RecordEditRejection(message)
  }

  switch (field) {
    case 'answer': {
      if (criterion.kind !== 'pass_fail' && criterion.kind !== 'pass_fail_na') return null
      return recordOp<EqAnswer | null>({
        current: criterion.answer,
        parse: (wire) => {
          const answer = parseEqAnswer(wireText(wire, 'Answer').trim())
          if (!answer) throw new RecordEditRejection('Answer is required.')
          if (answer === 'n_a' && criterion.kind !== 'pass_fail_na') {
            throw new RecordEditRejection('N/A is not allowed for this inspection item')
          }
          return answer
        },
        format: (value) => value ?? '',
        write: async (answer) => {
          if (!answer) throw new RecordEditRejection('Answer is required.')
          const clearFinding = answer !== 'fail'
          await save(
            {
              answer,
              answeredAt: new Date(),
              answeredByTenantUserId: ctx.membership?.id ?? null,
              ...(clearFinding ? { comment: null, actionTaken: null, correctedOn: null } : {}),
            },
            {
              summary: `Answered inspection item "${answer === 'n_a' ? 'N/A' : answer}"`,
              before: { rowId, answer: criterion.answer },
              after: { rowId, answer },
            },
          )
        },
      })
    }
    case 'severity':
      return recordOp<EqSeverity | null>({
        current: criterion.severity,
        parse: (wire) => {
          const raw = wireText(wire, 'Severity').trim()
          if (!raw) return null
          const severity = parseEqSeverity(raw)
          if (!severity) throw new RecordEditRejection('Severity is invalid.')
          return severity
        },
        format: (value) => value ?? '',
        write: async (severity) => {
          requireFail('Severity can only be set on a failed inspection item')
          await save(
            { severity },
            {
              summary: severity
                ? `Set finding severity to ${severity}`
                : 'Cleared finding severity',
              before: { rowId, severity: criterion.severity },
              after: { rowId, severity },
            },
          )
        },
      })
    case 'comment':
    case 'actionTaken': {
      const label = field === 'comment' ? 'Comment' : 'Action taken'
      return recordOp<string | null>({
        current: criterion[field],
        parse: (wire) => normalizeInspectionTextAnswer(wireText(wire, label)),
        format: (value) => value ?? '',
        write: async (value) => {
          requireFail(`${label} can only be set on a failed inspection item`)
          await save(
            { [field]: value },
            {
              summary: value
                ? `Updated finding ${label.toLowerCase()}`
                : `Cleared finding ${label.toLowerCase()}`,
              before: { rowId, [field]: criterion[field] },
              after: { rowId, [field]: value },
            },
          )
        },
      })
    }
    case 'value': {
      // The trusted kind comes from the snapshot row, never from the client.
      if (criterion.kind !== 'text' && criterion.kind !== 'numeric') return null
      const numeric = criterion.kind === 'numeric'
      return recordOp<string | null>({
        current: numeric ? criterion.numericValue : criterion.textValue,
        parse: (wire) =>
          numeric
            ? parseInspectionNumberAnswer(wireText(wire, 'Reading'))
            : normalizeInspectionTextAnswer(wireText(wire, 'Answer')),
        format: (value) => (numeric ? inspectionNumberAnswerWire(value) : (value ?? '')),
        write: async (value) => {
          const textValue = numeric ? null : value
          const numericValue = numeric ? value : null
          await save(
            {
              textValue,
              numericValue,
              answeredAt: value === null ? null : new Date(),
              answeredByTenantUserId: value === null ? null : (ctx.membership?.id ?? null),
            },
            {
              summary:
                value === null
                  ? 'Cleared inspection item response'
                  : 'Updated inspection item response',
              before: {
                rowId,
                textValue: criterion.textValue,
                numericValue: criterion.numericValue,
              },
              after: { rowId, textValue, numericValue },
            },
          )
        },
      })
    }
  }
}

export const equipmentInspectionRecordSaver = defineRecordSaver<EquipmentInspectionEdits>(
  'equipment-inspections',
  {
    authorize: (ctx) => can(ctx, 'equipment.inspect'),
    async load(tx, ctx, recordId) {
      // FOR UPDATE on the live tenant record, then the caller's read tier.
      const record = await lockVisibleEquipmentInspection(tx, ctx, recordId)
      if (!record) throw recordNotFound()
      if (equipmentInspectionIsFinalized(record)) {
        throw recordLocked(EQUIPMENT_INSPECTION_FINALIZED_MESSAGE)
      }
      return { record, criteria: new Map(), audits: [], meterChanged: false }
    },
    async resolve(tx, ctx, edits, op) {
      const criterionField = parseCriterionFieldId(op, EQUIPMENT_CRITERION_FIELDS)
      if (!criterionField) return recordFieldOp(tx, ctx, edits, op)
      const criterion = await criterionForEdit(tx, ctx, edits, criterionField.rowId)
      return criterion ? criterionFieldOp(tx, ctx, edits, criterion, criterionField.field) : null
    },
    async afterWrites(tx, ctx, edits) {
      const { record } = edits
      for (const audit of edits.audits) {
        await recordAuditInTransaction(tx, ctx, {
          entityType: 'equipment_inspection_record',
          entityId: record.id,
          action: 'update',
          ...audit,
        })
      }
      // A newer reading (or its date) moves the unit's hour meter.
      if (edits.meterChanged) await syncInspectionHoursInTx(tx, ctx, record)
      if (await markEquipmentInspectionInProgressIfDraft(tx, ctx, record)) {
        record.status = 'in_progress'
      }
    },
    revalidate: (recordId, { record }) => [
      `/equipment/inspections/${recordId}`,
      '/equipment/inspections',
      '/equipment/maintenance',
      ...(record.equipmentItemId ? [`/equipment/${record.equipmentItemId}`] : []),
    ],
  },
)
