// The `inspections` record saver: inline edits on a site inspection record —
// the general-info fields and every criterion answer and finding — queued on
// the device by the record page and applied by /api/records/sync (see
// lib/record-sync). The rules are the ones the inline editors have always
// had: the `inspections.update` permission, record visibility, closed or
// locked records are read-only, criterion rows must belong to the record,
// finding fields apply only to a failed criterion, and a non-fail answer
// clears the finding. Every write audits in the same transaction, the first
// answer starts a draft, and an edit that removes required evidence returns a
// submitted record to in-progress.
//
// Criterion fields are `criteria:<rowId>:<field>`. A non-fail answer clears
// the finding fields on the server; the card queues the same clears on the
// device, so whichever order a batch applies them in, each clear either
// writes or finds the value already cleared — never a false conflict.

import { and, eq, inArray, isNull } from 'drizzle-orm'
import { activePeopleWhere, activeTenantUsersWhere, type Database } from '@beaconhs/db'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import {
  correctiveActions,
  inspectionRecordCriteria,
  inspectionRecords,
  orgUnits,
  people,
  tenantUsers,
} from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import { canSeeRecord } from '@beaconhs/tenant/visibility'
import { recordAuditInTransaction } from '@/lib/audit'
import { dateIsoInTimeZone } from '@/lib/datetime'
import {
  inspectionNumberAnswerWire,
  isInspectionOutcomeResponseType,
  normalizeInspectionTextAnswer,
  parseInspectionNumberAnswer,
} from '@/lib/inspection-response-config'
import { optionalDateInput, optionalUuidInput, requireUuidArrayInput } from '@/lib/mutation-input'
import {
  columnOps,
  optionalRef,
  optionalText,
  requiredDateTime,
  type Codec,
} from '@/lib/record-sync/codecs'
import {
  defineRecordSaver,
  RecordEditRejection,
  recordLocked,
  recordNotFound,
  recordOp,
  type ErasedRecordOp,
} from '@/lib/record-sync/edits'
import {
  criterionAssignmentWire,
  parseCriterionFieldId,
} from '@/components/inspection/criterion-fields'
import {
  INSPECTION_RECORD_LOCKED_MESSAGE,
  inspectionRecordIsImmutable,
  lockInspectionCriterionForMutation,
  lockVisibleInspectionRecord,
  markInspectionInProgressIfDraft,
  parseAnswer,
  parseSeverity,
  reconcileSubmittedInspectionInTx,
} from './_lib'

type InspectionRow = typeof inspectionRecords.$inferSelect
type CriterionRow = typeof inspectionRecordCriteria.$inferSelect
type CriterionAnswer = NonNullable<CriterionRow['answer']>
type CriterionSeverity = NonNullable<CriterionRow['severity']>

const INSPECTION_CRITERION_FIELDS = [
  'answer',
  'choiceAnswer',
  'value',
  'severity',
  'nonCompliance',
  'actionTaken',
  'compliantNote',
  'assignment',
  'correctedOn',
] as const
type InspectionCriterionField = (typeof INSPECTION_CRITERION_FIELDS)[number]

type AuditEntry = {
  summary: string
  before: Record<string, unknown>
  after: Record<string, unknown>
}

type InspectionEdits = {
  record: InspectionRow
  /** Criterion rows of this record touched by the batch, locked on first use. */
  criteria: Map<string, CriterionRow>
  /** Audit entries for applied writes, in write order. */
  audits: AuditEntry[]
  /** An answer was recorded (a draft starts on its first answer). */
  startsWork: boolean
  criteriaChanged: boolean
  occurredAtChanged: boolean
}

/** Finding fields a pass or N/A answer clears. */
const FINDING_CLEARED = {
  severity: null,
  nonComplianceDescription: null,
  actionTaken: null,
  assignedToPersonId: null,
  assignedToTenantUserId: null,
  assignedDueDate: null,
  correctedOn: null,
} satisfies Partial<CriterionRow>

const RECORD_TEXT_FIELDS = {
  locationOnSite: 'Location on site',
  notes: 'Notes',
} as const

function wireText(wire: unknown, label: string): string {
  if (wire == null) return ''
  if (typeof wire === 'string') return wire
  throw new RecordEditRejection(`${label} is invalid.`)
}

function parseAssignment(wire: unknown): {
  assignedToPersonId: string | null
  assignedDueDate: string | null
} {
  if (!wire || typeof wire !== 'object' || Array.isArray(wire)) {
    throw new RecordEditRejection('Assignee is invalid.')
  }
  const value = wire as Record<string, unknown>
  return {
    assignedToPersonId: optionalUuidInput(value.assignedToPersonId ?? null, 'Assignee'),
    assignedDueDate: optionalDateInput(value.assignedDueDate ?? null, 'Due date'),
  }
}

/** A correction date is a real calendar date that is not in the future. */
function parseCorrectedOn(wire: unknown, timeZone: string, now = new Date()): string | null {
  const value = wireText(wire, 'Correction date').trim() || null
  if (
    value &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value ||
      value > dateIsoInTimeZone(now, timeZone))
  ) {
    throw new RecordEditRejection('Correction date must be a valid date that is not in the future')
  }
  return value
}

function recordFieldOp(
  tx: Database,
  ctx: RequestContext,
  edits: InspectionEdits,
  op: string,
): ErasedRecordOp | null {
  const { record } = edits
  const update = (patch: Partial<InspectionRow>) =>
    tx
      .update(inspectionRecords)
      .set(patch)
      .where(
        and(
          eq(inspectionRecords.tenantId, ctx.tenantId),
          eq(inspectionRecords.id, record.id),
          isNull(inspectionRecords.deletedAt),
        ),
      )
  const audited = (field: string, before: unknown, after: unknown) => {
    edits.audits.push({
      summary: `Updated ${field}`,
      before: { [field]: before },
      after: { [field]: after },
    })
  }

  if (op === 'foremanPersonIds') {
    return recordOp<string[]>({
      current: record.foremanPersonIds,
      parse: (wire) => requireUuidArrayInput(wire, 'Foreman selection', { min: 0, max: 20 }),
      format: (ids) => ids,
      write: async (ids) => {
        // Existing inactive selections may be retained or removed, but only
        // active people in this tenant can be newly added.
        const added = ids.filter((id) => !record.foremanPersonIds.includes(id))
        if (added.length) {
          const valid = await tx
            .select({ id: people.id })
            .from(people)
            .where(
              and(
                eq(people.tenantId, ctx.tenantId),
                inArray(people.id, added),
                activePeopleWhere(),
              ),
            )
          if (valid.length !== added.length) {
            throw new RecordEditRejection('Choose active foremen in this tenant.')
          }
        }
        const before = record.foremanPersonIds
        const previousText = record.foremanText
        await update({ foremanPersonIds: ids, foremanText: null })
        record.foremanPersonIds = ids
        record.foremanText = null
        audited('foremanPersonIds', before, ids)
        if (previousText) audited('foremanText', previousText, null)
      },
    })
  }

  if (op === 'siteOrgUnitId' || op === 'supervisorTenantUserId') {
    const label = op === 'siteOrgUnitId' ? 'Location' : 'Supervisor'
    const codec = optionalRef({ label })
    return recordOp<string | null>({
      current: record[op],
      parse: codec.parse,
      format: codec.format,
      write: async (value) => {
        if (value && op === 'supervisorTenantUserId') {
          const [supervisor] = await tx
            .select({ id: tenantUsers.id })
            .from(tenantUsers)
            .where(
              and(
                eq(tenantUsers.tenantId, ctx.tenantId),
                eq(tenantUsers.id, value),
                activeTenantUsersWhere(),
              ),
            )
            .limit(1)
          if (!supervisor) {
            throw new RecordEditRejection('Choose an active supervisor in this tenant.')
          }
        }
        if (value && op === 'siteOrgUnitId') {
          const [location] = await tx
            .select({ id: orgUnits.id })
            .from(orgUnits)
            .where(
              and(
                eq(orgUnits.tenantId, ctx.tenantId),
                eq(orgUnits.id, value),
                isNull(orgUnits.deletedAt),
              ),
            )
            .limit(1)
          if (!location) throw new RecordEditRejection('Location not found.')
        }
        const before = record[op]
        await update({ [op]: value })
        record[op] = value
        audited(op, before, value)
      },
    })
  }

  const textLabel = Object.hasOwn(RECORD_TEXT_FIELDS, op)
    ? RECORD_TEXT_FIELDS[op as keyof typeof RECORD_TEXT_FIELDS]
    : null
  if (op !== 'occurredAt' && !textLabel) return null
  const codecs: { [K in keyof InspectionRow]?: Codec<InspectionRow[K]> } =
    op === 'occurredAt'
      ? { occurredAt: requiredDateTime({ label: 'Occurred at', timeZone: ctx.timezone }) }
      : { [op]: optionalText({ label: textLabel ?? op }) }
  return columnOps(record, codecs, async (patch) => {
    const before = record[op as keyof InspectionRow]
    await update(patch)
    audited(op, before, patch[op as keyof InspectionRow])
    if (op === 'occurredAt') edits.occurredAtChanged = true
  })(op)
}

async function criterionForEdit(
  tx: Database,
  ctx: RequestContext,
  edits: InspectionEdits,
  rowId: string,
): Promise<CriterionRow | null> {
  const cached = edits.criteria.get(rowId)
  if (cached) return cached
  const criterion = await lockInspectionCriterionForMutation(
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
  edits: InspectionEdits,
  criterion: CriterionRow,
  field: InspectionCriterionField,
): ErasedRecordOp | null {
  const rowId = criterion.id
  const question = criterion.questionTextSnapshot.slice(0, 50)
  const answeredBy = ctx.membership?.id ?? null
  const save = async (patch: Partial<CriterionRow>, audit: AuditEntry) => {
    const [updated] = await tx
      .update(inspectionRecordCriteria)
      .set(patch)
      .where(
        and(
          eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
          eq(inspectionRecordCriteria.recordId, criterion.recordId),
          eq(inspectionRecordCriteria.id, rowId),
        ),
      )
      .returning({ id: inspectionRecordCriteria.id })
    if (!updated) throw new Error('Inspection criterion changed before it could be saved')
    Object.assign(criterion, patch)
    edits.audits.push(audit)
    edits.criteriaChanged = true
  }
  /** Finding fields only make sense on a failed criterion (clearing is always allowed). */
  const failOnly = (value: unknown, message: string) => {
    if (value && criterion.answer !== 'fail') throw new RecordEditRejection(message)
  }

  switch (field) {
    case 'answer': {
      if (!isInspectionOutcomeResponseType(criterion.responseType)) return null
      return recordOp<CriterionAnswer | null>({
        current: criterion.answer,
        parse: (wire) => {
          const answer = parseAnswer(wireText(wire, 'Answer').trim())
          if (!answer) throw new RecordEditRejection('Answer is required.')
          return answer
        },
        format: (value) => value ?? '',
        write: async (answer) => {
          if (!answer) throw new RecordEditRejection('Answer is required.')
          const before = criterion.answer
          await save(
            {
              answer,
              answeredAt: new Date(),
              answeredByTenantUserId: answeredBy,
              ...(answer === 'fail' ? {} : FINDING_CLEARED),
            },
            {
              summary: `Answered "${question}" — ${answer}`,
              before: { rowId, answer: before },
              after: { rowId, answer },
            },
          )
          edits.startsWork = true
        },
      })
    }
    case 'choiceAnswer': {
      if (criterion.responseType !== 'choice') return null
      return recordOp<string | null>({
        current: criterion.choiceAnswer,
        parse: (wire) => {
          const choice = wireText(wire, 'Answer').trim() || null
          if (choice && !(criterion.choiceOptionsSnapshot ?? []).includes(choice)) {
            throw new RecordEditRejection('Select one of the configured options')
          }
          return choice
        },
        format: (value) => value ?? '',
        write: async (choiceAnswer) => {
          const before = criterion.choiceAnswer
          await save(
            {
              choiceAnswer,
              answeredAt: choiceAnswer ? new Date() : null,
              answeredByTenantUserId: choiceAnswer ? answeredBy : null,
            },
            {
              summary: `Answered "${question}" — ${choiceAnswer ?? 'cleared'}`,
              before: { rowId, choiceAnswer: before },
              after: { rowId, choiceAnswer },
            },
          )
          if (choiceAnswer) edits.startsWork = true
        },
      })
    }
    case 'value': {
      const isText = criterion.responseType === 'text' || criterion.responseType === 'long_text'
      const isNumber = criterion.responseType === 'number'
      if (!isText && !isNumber) return null
      return recordOp<string | null>({
        current: isNumber ? criterion.numberAnswer : criterion.textAnswer,
        parse: (wire) =>
          isNumber
            ? parseInspectionNumberAnswer(wireText(wire, 'Answer'))
            : normalizeInspectionTextAnswer(wireText(wire, 'Answer')),
        format: (value) => (isNumber ? inspectionNumberAnswerWire(value) : (value ?? '')),
        write: async (value) => {
          const before = isNumber ? criterion.numberAnswer : criterion.textAnswer
          await save(
            {
              textAnswer: isText ? value : null,
              numberAnswer: isNumber ? value : null,
              answeredAt: value === null ? null : new Date(),
              answeredByTenantUserId: value === null ? null : answeredBy,
            },
            {
              summary: `Answered "${question}" — ${value ?? 'cleared'}`,
              before: { rowId, responseType: criterion.responseType, value: before },
              after: { rowId, responseType: criterion.responseType, value },
            },
          )
          if (value !== null) edits.startsWork = true
        },
      })
    }
    case 'severity':
      return recordOp<CriterionSeverity | null>({
        current: criterion.severity,
        parse: (wire) => {
          const raw = wireText(wire, 'Severity').trim()
          if (!raw) return null
          const severity = parseSeverity(raw)
          if (!severity) throw new RecordEditRejection('Severity is invalid.')
          return severity
        },
        format: (value) => value ?? '',
        write: async (severity) => {
          failOnly(severity, 'Severity applies only to a failed criterion')
          const before = criterion.severity
          await save(
            { severity },
            {
              summary: `Set severity to "${severity ?? 'cleared'}" on a finding`,
              before: { rowId, severity: before },
              after: { rowId, severity },
            },
          )
        },
      })
    case 'nonCompliance':
    case 'actionTaken':
    case 'compliantNote': {
      const column =
        field === 'nonCompliance'
          ? 'nonComplianceDescription'
          : field === 'actionTaken'
            ? 'actionTaken'
            : 'compliantNote'
      // Trimmed; blank clears it.
      const codec = optionalText({
        label:
          field === 'nonCompliance'
            ? 'Reason for non-compliance'
            : field === 'actionTaken'
              ? 'Action taken'
              : 'Notes',
      })
      return recordOp<string | null>({
        current: criterion[column],
        parse: codec.parse,
        format: codec.format,
        write: async (value) => {
          if (field === 'nonCompliance') {
            failOnly(value, 'A non-compliance description applies only to a failed criterion')
          }
          if (field === 'actionTaken') {
            failOnly(value, 'An action taken applies only to a failed criterion')
          }
          const before = criterion[column]
          await save(
            { [column]: value },
            {
              summary:
                field === 'nonCompliance'
                  ? 'Updated non-compliance description'
                  : field === 'actionTaken'
                    ? 'Updated action taken'
                    : 'Updated compliant note',
              before: { rowId, value: before },
              after: { rowId, value },
            },
          )
        },
      })
    }
    case 'assignment':
      return recordOp<{ assignedToPersonId: string | null; assignedDueDate: string | null }>({
        current: {
          assignedToPersonId: criterion.assignedToPersonId,
          assignedDueDate: criterion.assignedDueDate,
        },
        parse: parseAssignment,
        format: (value) => criterionAssignmentWire(value.assignedToPersonId, value.assignedDueDate),
        write: async ({ assignedToPersonId, assignedDueDate }) => {
          failOnly(
            assignedToPersonId || assignedDueDate,
            'An assignment applies only to a failed criterion',
          )
          let assignedToTenantUserId: string | null = null
          if (assignedToPersonId) {
            const [person] = await tx
              .select({ id: people.id, tenantUserId: tenantUsers.id })
              .from(people)
              .leftJoin(
                tenantUsers,
                and(
                  eq(tenantUsers.tenantId, people.tenantId),
                  eq(tenantUsers.userId, people.userId),
                  activeTenantUsersWhere(),
                ),
              )
              .where(
                and(
                  eq(people.tenantId, ctx.tenantId),
                  eq(people.id, assignedToPersonId),
                  activePeopleWhere(),
                ),
              )
              .limit(1)
            if (!person) throw new RecordEditRejection('Assignee not found')
            assignedToTenantUserId = person.tenantUserId
          }
          const before = {
            rowId,
            assignedToPersonId: criterion.assignedToPersonId,
            assignedToTenantUserId: criterion.assignedToTenantUserId,
            assignedDueDate: criterion.assignedDueDate,
          }
          await save(
            { assignedToPersonId, assignedToTenantUserId, assignedDueDate },
            {
              summary: 'Updated assignment',
              before,
              after: { rowId, assignedToPersonId, assignedToTenantUserId, assignedDueDate },
            },
          )
        },
      })
    case 'correctedOn':
      return recordOp<string | null>({
        current: criterion.correctedOn,
        parse: (wire) => parseCorrectedOn(wire, ctx.timezone),
        format: (value) => value ?? '',
        write: async (correctedOn) => {
          failOnly(correctedOn, 'A correction date applies only to a failed criterion')
          if (criterion.correctiveActionId) {
            const manageTheAction =
              'Manage the linked corrective action to change its resolution. Closed actions keep their history.'
            if (!can(ctx, 'ca.update')) throw new RecordEditRejection(manageTheAction)
            const [ca] = await tx
              .select()
              .from(correctiveActions)
              .where(
                and(
                  eq(correctiveActions.tenantId, ctx.tenantId),
                  eq(correctiveActions.id, criterion.correctiveActionId),
                  isNull(correctiveActions.deletedAt),
                ),
              )
              .limit(1)
              .for('update')
            if (ca && (ca.locked || ca.status === 'closed' || ca.status === 'cancelled')) {
              throw new RecordEditRejection(manageTheAction)
            }
            if (
              ca &&
              !(await canSeeRecord(ctx, tx, {
                prefix: 'ca',
                ownerIds: [ca.ownerTenantUserId],
                siteId: ca.siteOrgUnitId,
              }))
            ) {
              throw new RecordEditRejection('Corrective action not found.')
            }
          }
          const before = criterion.correctedOn
          await save(
            { correctedOn },
            {
              summary: correctedOn
                ? `Marked finding corrected on ${correctedOn}`
                : 'Cleared corrected-on date',
              before: { rowId, correctedOn: before },
              after: { rowId, correctedOn },
            },
          )
        },
      })
  }
}

export const inspectionRecordSaver = defineRecordSaver<InspectionEdits>('inspections', {
  authorize: (ctx) => can(ctx, 'inspections.update'),
  async load(tx, ctx, recordId) {
    // FOR UPDATE on the live tenant record, then the caller's read tier.
    const record = await lockVisibleInspectionRecord(tx, ctx, recordId)
    if (!record) throw recordNotFound()
    if (inspectionRecordIsImmutable(record)) throw recordLocked(INSPECTION_RECORD_LOCKED_MESSAGE)
    return {
      record,
      criteria: new Map(),
      audits: [],
      startsWork: false,
      criteriaChanged: false,
      occurredAtChanged: false,
    }
  },
  async resolve(tx, ctx, edits, op) {
    const criterionField = parseCriterionFieldId(op, INSPECTION_CRITERION_FIELDS)
    if (!criterionField) return recordFieldOp(tx, ctx, edits, op)
    const criterion = await criterionForEdit(tx, ctx, edits, criterionField.rowId)
    return criterion ? criterionFieldOp(tx, ctx, edits, criterion, criterionField.field) : null
  },
  async afterWrites(tx, ctx, edits) {
    const { record } = edits
    if (edits.startsWork && (await markInspectionInProgressIfDraft(tx, ctx, record))) {
      record.status = 'in_progress'
    }
    for (const audit of edits.audits) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'inspection_record',
        entityId: record.id,
        action: 'update',
        ...audit,
      })
    }
    if (edits.occurredAtChanged) {
      await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
        sourceModule: 'inspection',
        targetRef: { inspectionTypeId: record.typeId },
      })
    }
    // An edit that removes required evidence returns a submitted record to in progress.
    if (edits.criteriaChanged) await reconcileSubmittedInspectionInTx(tx, ctx, record)
  },
  revalidate: (recordId) => [`/inspections/records/${recordId}`],
})
