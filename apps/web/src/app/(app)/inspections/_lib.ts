// Shared helpers for the inspections module — reference generation, criteria
// materialisation, audience expansion, and auto-CA spawning.
//
// Kept route-local (underscore-prefixed) so the implementation lives next to
// the pages that use it. Anything cross-module-worthy can be promoted to
// /lib/ later.

import { randomUUID } from 'node:crypto'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { RequestContext } from '@beaconhs/tenant'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import { moduleFlowCommand, recordDomainEvent, recordModuleFlowEvent } from '@beaconhs/events'
import { correctiveActionCreatedEvent } from '@beaconhs/integrations'
import {
  correctiveActions,
  inspectionRecordCriteria,
  inspectionRecords,
  inspectionTypeCriteria,
  inspectionTypeGroups,
  inspectionTypes,
} from '@beaconhs/db/schema'
import { recordAuditInTransaction } from '@/lib/audit'
import { nextReference } from '@/lib/reference'
import { inspectionCriterionIsAnswered } from '@/lib/inspection-response-config'
import { inspectionStatusMilestonePatch } from '@/lib/inspection-record-lifecycle'
import { canSeeRecord } from '@/lib/visibility'
import { validateTenantImageAttachmentIdsInTx } from '@/lib/attachment-validation'

export { inspectionStatusMilestonePatch } from '@/lib/inspection-record-lifecycle'

type CriterionAnswer = 'pass' | 'fail' | 'n_a'
type CriterionSeverity = 'low' | 'medium' | 'high' | 'critical'

const ANSWER_VALUES = ['pass', 'fail', 'n_a'] as const
const SEVERITY_VALUES = ['low', 'medium', 'high', 'critical'] as const

type InspectionTx = Parameters<Parameters<RequestContext['db']>[0]>[0]

export async function lockInspectionRecordForMutation(
  tx: InspectionTx,
  tenantId: string,
  recordId: string,
): Promise<typeof inspectionRecords.$inferSelect | null> {
  const [record] = await tx
    .select()
    .from(inspectionRecords)
    .where(
      and(
        eq(inspectionRecords.tenantId, tenantId),
        eq(inspectionRecords.id, recordId),
        isNull(inspectionRecords.deletedAt),
      ),
    )
    .limit(1)
    .for('update')
  return record ?? null
}

export async function lockVisibleInspectionRecordForMutation(
  tx: InspectionTx,
  ctx: RequestContext,
  recordId: string,
  opts?: { allowLocked?: boolean },
): Promise<typeof inspectionRecords.$inferSelect> {
  const record = await lockInspectionRecordForMutation(tx, ctx.tenantId, recordId)
  if (!record) throw new Error('Inspection record not found')
  const visible = await canSeeRecord(ctx, tx, {
    prefix: 'inspections',
    ownerIds: [record.inspectorTenantUserId, record.submittedByTenantUserId],
    siteId: record.siteOrgUnitId,
  })
  if (!visible) throw new Error('Inspection record not found')
  if ((record.locked || record.status === 'closed') && !opts?.allowLocked) {
    throw new Error('Record is closed or locked. Reopen or unlock it before making changes.')
  }
  return record
}

export function parseAnswer(raw: unknown): CriterionAnswer | null {
  return typeof raw === 'string' && (ANSWER_VALUES as readonly string[]).includes(raw)
    ? (raw as CriterionAnswer)
    : null
}

export function parseSeverity(raw: unknown): CriterionSeverity | null {
  return typeof raw === 'string' && (SEVERITY_VALUES as readonly string[]).includes(raw)
    ? (raw as CriterionSeverity)
    : null
}

/**
 * Generate the next sequential record reference (INS-YYYY-NNNN). Counts
 * records by occurredAt-year so a re-imported historical batch doesn't fight
 * with this year's series.
 */
export async function nextInspectionReferenceInTx(
  tx: InspectionTx,
  tenantId: string,
  occurredAt: Date,
): Promise<string> {
  return nextReference(tx, tenantId, 'inspection', occurredAt.getFullYear())
}

/**
 * Materialise inspection_record_criteria rows for a new inspection_record by
 * walking the type's own criteria — in group order (ungrouped last), then
 * criterion order — and snapshotting the group label + response config onto
 * each row so the fill view renders section headers and the right controls
 * without joining back to the live type.
 */
export async function materialiseCriteriaForRecordInTx(
  tx: InspectionTx,
  tenantId: string,
  recordId: string,
  typeId: string,
): Promise<number> {
  const rows = await tx
    .select({
      criterion: inspectionTypeCriteria,
      groupLabel: inspectionTypeGroups.label,
    })
    .from(inspectionTypeCriteria)
    .leftJoin(
      inspectionTypeGroups,
      and(
        eq(inspectionTypeGroups.tenantId, inspectionTypeCriteria.tenantId),
        eq(inspectionTypeGroups.id, inspectionTypeCriteria.groupId),
      ),
    )
    .where(
      and(eq(inspectionTypeCriteria.tenantId, tenantId), eq(inspectionTypeCriteria.typeId, typeId)),
    )
    // Ungrouped criteria (null group) sort last via the coalesce sentinel.
    .orderBy(
      sql`coalesce(${inspectionTypeGroups.sequence}, 2147483647)`,
      inspectionTypeCriteria.sequence,
      inspectionTypeCriteria.id,
    )
  if (rows.length === 0) return 0
  await tx.insert(inspectionRecordCriteria).values(
    rows.map((r, i) => ({
      tenantId,
      recordId,
      criterionId: r.criterion.id,
      questionTextSnapshot: r.criterion.text,
      groupLabelSnapshot: r.groupLabel ?? null,
      responseType: r.criterion.responseType,
      choiceOptionsSnapshot: r.criterion.choiceOptions,
      requiresPhoto: r.criterion.requiresPhoto,
      requiresComment: r.criterion.requiresComment,
      sequence: i,
    })),
  )
  return rows.length
}

/**
 * Decide whether a fail-severity combination should trigger an auto-CA.
 * Spec: severity ≥ high.
 */
function shouldSpawnCorrectiveAction(
  answer: CriterionAnswer | null,
  severity: CriterionSeverity | null,
): boolean {
  return answer === 'fail' && (severity === 'high' || severity === 'critical')
}

/**
 * Idempotently spawn (or link) a corrective_action for a failed criterion
 * row, then update the row's correctiveActionId pointer.
 *
 * If a CA already exists for this row, we update the existing one with the
 * latest description / severity / due date / assignee instead of spawning a
 * duplicate.
 *
 * Returns `{ caId, created }` — caId is null when no CA should exist (answer
 * was changed back to pass/N-A, or severity dropped below high). When a NEW
 * CA is spawned, its create audit (both the CA-side and record-side entries)
 * is written here so every caller path is audited consistently.
 */
export async function syncCorrectiveActionForCriterionInTx(
  tx: InspectionTx,
  ctx: RequestContext,
  recordId: string,
  criterionRowId: string,
): Promise<{ caId: string | null; created: boolean }> {
  const [row] = await tx
    .select({
      c: inspectionRecordCriteria,
      record: inspectionRecords,
      type: inspectionTypes,
    })
    .from(inspectionRecordCriteria)
    .innerJoin(
      inspectionRecords,
      and(
        eq(inspectionRecords.tenantId, inspectionRecordCriteria.tenantId),
        eq(inspectionRecords.id, inspectionRecordCriteria.recordId),
      ),
    )
    .innerJoin(
      inspectionTypes,
      and(
        eq(inspectionTypes.tenantId, inspectionRecords.tenantId),
        eq(inspectionTypes.id, inspectionRecords.typeId),
      ),
    )
    .where(
      and(
        eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
        eq(inspectionRecordCriteria.recordId, recordId),
        eq(inspectionRecordCriteria.id, criterionRowId),
        isNull(inspectionRecords.deletedAt),
      ),
    )
    .limit(1)
  if (!row) throw new Error('Inspection criterion not found')

  const answer = row.c.answer as CriterionAnswer | null
  const severity = row.c.severity as CriterionSeverity | null
  const shouldHaveCA =
    row.type.enableCorrectiveActions && shouldSpawnCorrectiveAction(answer, severity)

  // Removing the link never deletes a CA that may already be under active
  // remediation; it only stops the criterion from treating it as its current
  // auto-synchronized action.
  if (!shouldHaveCA) {
    if (row.c.correctiveActionId) {
      await tx
        .update(inspectionRecordCriteria)
        .set({ correctiveActionId: null })
        .where(
          and(
            eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
            eq(inspectionRecordCriteria.recordId, recordId),
            eq(inspectionRecordCriteria.id, criterionRowId),
          ),
        )
    }
    return { caId: null, created: false }
  }

  const title = `Inspection finding: ${row.c.questionTextSnapshot.slice(0, 80)}`
  const description =
    [
      row.c.nonComplianceDescription ?? '',
      row.c.compliantNote ? `\n\nNotes: ${row.c.compliantNote}` : '',
      row.c.actionTaken ? `\n\nAction taken: ${row.c.actionTaken}` : '',
    ]
      .join('')
      .trim() || row.c.questionTextSnapshot
  const dayOffset = severity === 'critical' ? 1 : severity === 'high' ? 3 : 7
  const dueDate = new Date(row.record.occurredAt)
  dueDate.setDate(dueDate.getDate() + dayOffset)
  const dueOn = row.c.assignedDueDate ?? dueDate.toISOString().slice(0, 10)
  const caSeverity = severity ?? 'high'
  const caOwnerTenantUserId = row.c.assignedToTenantUserId ?? ctx.membership?.id ?? null

  if (row.c.correctiveActionId) {
    const [existing] = await tx
      .select()
      .from(correctiveActions)
      .where(
        and(
          eq(correctiveActions.tenantId, ctx.tenantId),
          eq(correctiveActions.id, row.c.correctiveActionId),
          isNull(correctiveActions.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (existing) {
      const changed =
        existing.title !== title ||
        existing.description !== description ||
        existing.severity !== caSeverity ||
        existing.dueOn !== dueOn ||
        existing.siteOrgUnitId !== row.record.siteOrgUnitId ||
        existing.actionTaken !== row.c.actionTaken ||
        existing.ownerTenantUserId !== caOwnerTenantUserId
      if (changed) {
        const [updated] = await tx
          .update(correctiveActions)
          .set({
            title,
            description,
            severity: caSeverity,
            dueOn,
            siteOrgUnitId: row.record.siteOrgUnitId,
            actionTaken: row.c.actionTaken,
            ownerTenantUserId: caOwnerTenantUserId,
          })
          .where(
            and(
              eq(correctiveActions.tenantId, ctx.tenantId),
              eq(correctiveActions.id, existing.id),
              isNull(correctiveActions.deletedAt),
            ),
          )
          .returning()
        if (!updated) throw new Error('Corrective action changed before it could be synchronized')
        await recordAuditInTransaction(tx, ctx, {
          entityType: 'corrective_action',
          entityId: existing.id,
          action: 'update',
          summary: `Synchronized from inspection ${row.record.reference}`,
          before: {
            title: existing.title,
            severity: existing.severity,
            dueOn: existing.dueOn,
          },
          after: { title, severity: caSeverity, dueOn, ownerTenantUserId: caOwnerTenantUserId },
        })
        await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
          sourceModule: 'corrective_action',
          targetRef: {},
        })
      }
      return { caId: existing.id, created: false }
    }

    // A soft-deleted linked CA is not a valid synchronization target.
    await tx
      .update(inspectionRecordCriteria)
      .set({ correctiveActionId: null })
      .where(
        and(
          eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
          eq(inspectionRecordCriteria.recordId, recordId),
          eq(inspectionRecordCriteria.id, criterionRowId),
        ),
      )
  }

  const reference = await nextReference(tx, ctx.tenantId, 'corrective_action')
  const [ca] = await tx
    .insert(correctiveActions)
    .values({
      tenantId: ctx.tenantId,
      reference,
      title,
      description,
      severity: caSeverity,
      status: 'open',
      source: 'inspection',
      sourceEntityType: 'inspection_record',
      sourceEntityId: recordId,
      siteOrgUnitId: row.record.siteOrgUnitId,
      assignedOn: new Date().toISOString().slice(0, 10),
      dueOn,
      assignedByTenantUserId: ctx.membership?.id ?? null,
      ownerTenantUserId: caOwnerTenantUserId,
    })
    .returning()
  if (!ca) throw new Error('Corrective action could not be created')

  const [linked] = await tx
    .update(inspectionRecordCriteria)
    .set({ correctiveActionId: ca.id })
    .where(
      and(
        eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
        eq(inspectionRecordCriteria.recordId, recordId),
        eq(inspectionRecordCriteria.id, criterionRowId),
      ),
    )
    .returning({ id: inspectionRecordCriteria.id })
  if (!linked) throw new Error('Inspection criterion disappeared while linking corrective action')

  await recordDomainEvent(tx, {
    tenantId: ctx.tenantId,
    eventType: 'corrective_action.created',
    subjectId: ca.id,
    dedupKey: `corrective_action.created:${ca.id}`,
    payload: {
      notification: { kind: 'corrective_action_assigned', caId: ca.id },
      integration: correctiveActionCreatedEvent(ctx.tenantId, {
        id: ca.id,
        reference: ca.reference,
        title: ca.title,
        status: ca.status,
        severity: ca.severity,
        source: ca.source,
        dueOn: ca.dueOn,
        assignedOn: ca.assignedOn,
      }),
      web: moduleFlowCommand(ctx, {
        subjectId: ca.id,
        moduleKey: 'corrective-actions',
        event: 'on_create',
      }),
    },
  })
  await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
    sourceModule: 'corrective_action',
    targetRef: {},
  })
  await recordAuditInTransaction(tx, ctx, {
    entityType: 'corrective_action',
    entityId: ca.id,
    action: 'create',
    summary: `Auto-spawned from inspection finding (severity ${caSeverity})`,
    after: { sourceEntityType: 'inspection_record', sourceEntityId: recordId },
  })
  await recordAuditInTransaction(tx, ctx, {
    entityType: 'inspection_record',
    entityId: recordId,
    action: 'update',
    summary: `Auto-spawned corrective action ${ca.reference}`,
    metadata: { correctiveActionId: ca.id, criterionRowId },
  })
  return { caId: ca.id, created: true }
}

/**
 * Walk a record's criteria + return human-readable list of unanswered /
 * incomplete rows. Used by the submit gate so the inspector sees what's
 * missing before the system flips the status to 'submitted'.
 */
async function findIncompleteCriteriaInTx(
  tx: InspectionTx,
  tenantId: string,
  recordId: string,
): Promise<string[]> {
  const rows = await tx
    .select()
    .from(inspectionRecordCriteria)
    .where(
      and(
        eq(inspectionRecordCriteria.tenantId, tenantId),
        eq(inspectionRecordCriteria.recordId, recordId),
      ),
    )

  const missing: string[] = []
  for (const r of rows) {
    if (
      !inspectionCriterionIsAnswered({
        responseType: r.responseType,
        outcomeAnswer: r.answer,
        choiceAnswer: r.choiceAnswer,
        textAnswer: r.textAnswer,
        numberAnswer: r.numberAnswer,
      })
    ) {
      missing.push(`${r.questionTextSnapshot}: no answer`)
      continue
    }
    if (
      r.responseType === 'choice' &&
      r.choiceAnswer &&
      !(r.choiceOptionsSnapshot ?? []).includes(r.choiceAnswer)
    ) {
      missing.push(`${r.questionTextSnapshot}: selected option is no longer valid`)
      continue
    }
    if (r.answer === 'fail') {
      if (!r.severity) missing.push(`${r.questionTextSnapshot}: severity`)
      if (!r.nonComplianceDescription)
        missing.push(`${r.questionTextSnapshot}: non-compliance description`)
    }
    if (r.requiresPhoto && r.answer !== 'n_a' && (r.photoAttachmentIds ?? []).length === 0)
      missing.push(`${r.questionTextSnapshot}: photo evidence`)
    if (r.requiresComment && r.answer !== 'fail' && !r.compliantNote)
      missing.push(`${r.questionTextSnapshot}: comment`)
  }
  return missing
}

/**
 * Submitted inspections remain editable until they are closed. If an edit
 * removes required evidence, atomically return the record to in-progress so a
 * submitted status can never claim completeness that no longer exists.
 * Caller must already hold the inspection parent row lock.
 */
export async function reconcileSubmittedInspectionInTx(
  tx: InspectionTx,
  ctx: RequestContext,
  record: typeof inspectionRecords.$inferSelect,
): Promise<boolean> {
  if (record.status !== 'submitted') return false
  const missing = await findIncompleteCriteriaInTx(tx, ctx.tenantId, record.id)
  if (missing.length === 0) return false

  const patch = inspectionStatusMilestonePatch(
    record,
    'in_progress',
    ctx.membership?.id ?? null,
    new Date(),
  )
  const [updated] = await tx
    .update(inspectionRecords)
    .set(patch)
    .where(
      and(
        eq(inspectionRecords.tenantId, ctx.tenantId),
        eq(inspectionRecords.id, record.id),
        eq(inspectionRecords.status, 'submitted'),
        isNull(inspectionRecords.deletedAt),
      ),
    )
    .returning({ id: inspectionRecords.id })
  if (!updated) throw new Error('Inspection status changed before completeness could be reconciled')

  await recordModuleFlowEvent(tx, ctx, {
    subjectId: record.id,
    moduleKey: 'inspections',
    event: 'status_change',
    toStatus: 'in_progress',
    occurrenceKey: randomUUID(),
  })
  await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
    sourceModule: 'inspection',
    targetRef: { inspectionTypeId: record.typeId },
  })
  await recordAuditInTransaction(tx, ctx, {
    entityType: 'inspection_record',
    entityId: record.id,
    action: 'update',
    summary: 'Returned to in progress after required inspection evidence was removed',
    before: { status: 'submitted' },
    after: { status: 'in_progress' },
    metadata: { missingCount: missing.length, firstMissing: missing[0] },
  })
  return true
}

export class InspectionTransitionError extends Error {
  override readonly name = 'InspectionTransitionError'

  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message)
  }
}

export async function assertInspectionStatusTransitionInTx(
  tx: InspectionTx,
  tenantId: string,
  record: typeof inspectionRecords.$inferSelect,
  nextStatus: typeof inspectionRecords.$inferSelect.status,
): Promise<void> {
  const submitting = nextStatus === 'submitted' || nextStatus === 'closed'
  if (submitting) {
    const missing = await findIncompleteCriteriaInTx(tx, tenantId, record.id)
    if (missing.length > 0) {
      throw new InspectionTransitionError(
        `Cannot submit: ${missing.length} inspection item${missing.length === 1 ? '' : 's'} incomplete`,
        missing,
      )
    }
  }
  if (nextStatus !== 'closed') return

  const [type] = await tx
    .select({
      requiresCustomerSignature: inspectionTypes.requiresCustomerSignature,
      requiresForeman: inspectionTypes.requiresForeman,
    })
    .from(inspectionTypes)
    .where(and(eq(inspectionTypes.tenantId, tenantId), eq(inspectionTypes.id, record.typeId)))
    .limit(1)
  if (!type) throw new InspectionTransitionError('Inspection type no longer exists')
  if (type.requiresCustomerSignature && !record.customerSignatureAttachmentId) {
    throw new InspectionTransitionError(
      'Cannot close: this inspection type requires a customer signature.',
    )
  }
  if (type.requiresForeman && !record.foremanText && (record.foremanPersonIds ?? []).length === 0) {
    throw new InspectionTransitionError(
      'Cannot close: this inspection type requires a foreman on the record.',
    )
  }
}

export async function validateInspectionPhotoAttachmentIdsInTx(
  tx: InspectionTx,
  tenantId: string,
  attachmentIds: readonly string[],
): Promise<string[]> {
  return validateTenantImageAttachmentIdsInTx(tx, tenantId, attachmentIds)
}
