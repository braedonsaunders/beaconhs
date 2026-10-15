// The `hazard-assessments` record saver: inline edits on a hazard assessment,
// queued on the device by the record page and applied by /api/records/sync
// (see lib/record-sync). Same rules the inline editors have always had — the
// `hazid.update` permission, the visibility-scoped parent lock (FOR UPDATE),
// locked (signed) assessments are read-only, child rows must belong to the
// assessment — plus a compare-and-set against the value the device last saw.
// Writes land on the same tables as the Server Actions, so the database's
// signature-invalidation triggers keep clearing ink when job content changes.

import { and, eq, inArray, isNull } from 'drizzle-orm'
import { activePeopleWhere, type Database } from '@beaconhs/db'
import {
  formResponses,
  hazidAssessmentAppResponses,
  hazidAssessmentHazards,
  hazidAssessmentPPE,
  hazidAssessmentQuestions,
  hazidAssessments,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { recordAuditInTransaction } from '@/lib/audit'
import {
  choice,
  columnOps,
  optionalRef,
  optionalRichText,
  optionalText,
  requiredDateTime,
  type Codec,
} from '@/lib/record-sync/codecs'
import {
  RecordEditRejection,
  defineRecordSaver,
  recordLocked,
  recordNotFound,
  recordOp,
  type ErasedRecordOp,
  type RecordChange,
} from '@/lib/record-sync/edits'
import {
  PPE_ANSWERS,
  nullableText,
  parseAssessmentRowOp,
  parseQuestionAnswer,
  postedFlag,
  wireText,
  type AssessmentRowOp,
  type PpeAnswer,
} from './_assessment-inputs'
import {
  ASSESSMENT_LOCKED_MESSAGE,
  assessmentPaths,
  createAutoAssessmentApps,
  lockVisibleAssessmentRow,
  updateAssessmentHazardRow,
  type HazidAssessmentRow,
  type HazidCtx,
} from './_assessment-rules'

type HazardRow = typeof hazidAssessmentHazards.$inferSelect
type PpeRow = typeof hazidAssessmentPPE.$inferSelect
type QuestionRow = typeof hazidAssessmentQuestions.$inferSelect

type LoadedAssessment = {
  ctx: HazidCtx
  row: HazidAssessmentRow
  // Child rows locked by this batch (null = not on this assessment).
  hazards: Map<string, HazardRow | null>
  ppe: Map<string, PpeRow | null>
  questions: Map<string, QuestionRow | null>
}

/** General-information fields edited inline on the record page. */
function assessmentCodecs(timeZone: string): {
  [K in keyof HazidAssessmentRow]?: Codec<HazidAssessmentRow[K]>
} {
  return {
    assessmentTypeId: optionalRef({ label: 'Assessment type' }),
    occurredAt: requiredDateTime({ label: 'Date & time', timeZone }),
    supervisorPersonId: optionalRef({ label: 'Supervisor' }),
    siteOrgUnitId: optionalRef({ label: 'Location' }),
    projectOrgUnitId: optionalRef({ label: 'Project' }),
    locationOnSite: optionalText({ label: 'Specific location' }),
    jobScope: optionalRichText({ label: 'Job scope' }),
  }
}

async function writeAssessment(
  tx: Database,
  loaded: LoadedAssessment,
  patch: Partial<HazidAssessmentRow>,
): Promise<void> {
  const { ctx, row } = loaded
  if (patch.supervisorPersonId) {
    const [supervisor] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.tenantId, ctx.tenantId),
          eq(people.id, patch.supervisorPersonId),
          activePeopleWhere(),
        ),
      )
      .limit(1)
    if (!supervisor) throw new RecordEditRejection('Choose an active supervisor')
  }
  if (patch.siteOrgUnitId) {
    const [location] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(
        and(
          eq(orgUnits.tenantId, ctx.tenantId),
          eq(orgUnits.id, patch.siteOrgUnitId),
          isNull(orgUnits.deletedAt),
        ),
      )
      .limit(1)
    if (!location) throw new RecordEditRejection('Location not found')
  }
  await tx
    .update(hazidAssessments)
    .set(patch)
    .where(and(eq(hazidAssessments.tenantId, ctx.tenantId), eq(hazidAssessments.id, row.id)))
  if ('siteOrgUnitId' in patch) {
    await syncLinkedAppSites(tx, ctx, row.id, patch.siteOrgUnitId ?? null)
  }
}

/**
 * Embedded app responses inherit the assessment's location. They are owned by
 * the assessment, whose row this batch holds FOR UPDATE (the same parent-first
 * lock order the HazID Server Actions use for linked responses).
 */
async function syncLinkedAppSites(
  tx: Database,
  ctx: HazidCtx,
  assessmentId: string,
  siteOrgUnitId: string | null,
): Promise<void> {
  const linkedResponses = await tx
    .select({ id: hazidAssessmentAppResponses.responseId })
    .from(hazidAssessmentAppResponses)
    .where(
      and(
        eq(hazidAssessmentAppResponses.tenantId, ctx.tenantId),
        eq(hazidAssessmentAppResponses.assessmentId, assessmentId),
      ),
    )
  if (linkedResponses.length === 0) return
  await tx
    .update(formResponses)
    .set({ siteOrgUnitId })
    .where(
      and(
        eq(formResponses.tenantId, ctx.tenantId),
        inArray(
          formResponses.id,
          linkedResponses.map((response) => response.id),
        ),
        isNull(formResponses.deletedAt),
      ),
    )
}

async function lockedChild<T>(
  rows: Map<string, T | null>,
  rowId: string,
  load: () => Promise<T | undefined>,
): Promise<T | null> {
  if (!rows.has(rowId)) rows.set(rowId, (await load()) ?? null)
  return rows.get(rowId) ?? null
}

const PPE_ANSWER = choice(PPE_ANSWERS, { label: 'Answer' })

async function resolveRowOp(
  tx: Database,
  loaded: LoadedAssessment,
  op: AssessmentRowOp,
): Promise<ErasedRecordOp | null> {
  const { ctx, row: assessment } = loaded
  switch (op.kind) {
    case 'hazards': {
      const hazard = await lockedChild(loaded.hazards, op.rowId, async () => {
        const [found] = await tx
          .select()
          .from(hazidAssessmentHazards)
          .where(
            and(
              eq(hazidAssessmentHazards.tenantId, ctx.tenantId),
              eq(hazidAssessmentHazards.id, op.rowId),
              eq(hazidAssessmentHazards.assessmentId, assessment.id),
            ),
          )
          .limit(1)
          .for('update')
        return found
      })
      if (!hazard) return null
      const write = (updates: { applicable: boolean } | { specificControls: string | null }) =>
        updateAssessmentHazardRow(tx, ctx, {
          assessmentId: assessment.id,
          hazardRowId: hazard.id,
          updates,
        })
      if (op.field === 'applicable') {
        return recordOp<boolean>({
          current: hazard.applicable,
          parse: postedFlag,
          format: (value) => (value ? 'true' : 'false'),
          write: async (value) => {
            await write({ applicable: value })
            hazard.applicable = value
          },
        })
      }
      return recordOp<string | null>({
        current: hazard.specificControls,
        parse: (wire) => nullableText(wireText(wire)),
        format: (value) => value ?? '',
        write: async (value) => {
          await write({ specificControls: value })
          hazard.specificControls = value
        },
      })
    }
    case 'ppe': {
      const ppe = await lockedChild(loaded.ppe, op.rowId, async () => {
        const [found] = await tx
          .select()
          .from(hazidAssessmentPPE)
          .where(
            and(
              eq(hazidAssessmentPPE.tenantId, ctx.tenantId),
              eq(hazidAssessmentPPE.id, op.rowId),
              eq(hazidAssessmentPPE.assessmentId, assessment.id),
            ),
          )
          .limit(1)
          .for('update')
        return found
      })
      if (!ppe) return null
      // A PPE row is answered yes / no / n/a; it cannot be cleared again.
      return recordOp<PpeAnswer | null>({
        current: ppe.answer,
        parse: PPE_ANSWER.parse,
        format: (value) => value ?? '',
        write: async (value) => {
          await tx
            .update(hazidAssessmentPPE)
            .set({ answer: value })
            .where(
              and(
                eq(hazidAssessmentPPE.tenantId, ctx.tenantId),
                eq(hazidAssessmentPPE.id, ppe.id),
                eq(hazidAssessmentPPE.assessmentId, assessment.id),
              ),
            )
          ppe.answer = value
        },
      })
    }
    case 'questions': {
      const question = await lockedChild(loaded.questions, op.rowId, async () => {
        const [found] = await tx
          .select()
          .from(hazidAssessmentQuestions)
          .where(
            and(
              eq(hazidAssessmentQuestions.tenantId, ctx.tenantId),
              eq(hazidAssessmentQuestions.id, op.rowId),
              eq(hazidAssessmentQuestions.assessmentId, assessment.id),
            ),
          )
          .limit(1)
          .for('update')
        return found
      })
      if (!question) return null
      return recordOp<string | null>({
        current: question.answer,
        parse: (wire) => parseQuestionAnswer(question, wire),
        format: (value) => value ?? '',
        write: async (value) => {
          await tx
            .update(hazidAssessmentQuestions)
            .set({ answer: value })
            .where(
              and(
                eq(hazidAssessmentQuestions.tenantId, ctx.tenantId),
                eq(hazidAssessmentQuestions.id, question.id),
                eq(hazidAssessmentQuestions.assessmentId, assessment.id),
              ),
            )
          question.answer = value
        },
      })
    }
  }
}

/** The audit entry each inline edit has always written. */
function auditEntry(
  assessmentId: string,
  change: RecordChange,
): { entityType: string; entityId: string; summary: string; field: string } {
  const rowOp = parseAssessmentRowOp(change.op)
  if (!rowOp) {
    return {
      entityType: 'hazid_assessment',
      entityId: assessmentId,
      summary: `Updated ${change.op}`,
      field: change.op,
    }
  }
  switch (rowOp.kind) {
    case 'hazards':
      return {
        entityType: 'hazid_assessment_hazard',
        entityId: rowOp.rowId,
        summary: 'Updated hazard',
        field: rowOp.field,
      }
    case 'ppe':
      return {
        entityType: 'hazid_assessment_ppe',
        entityId: rowOp.rowId,
        summary: `Answered PPE row: ${String(change.after)}`,
        field: rowOp.field,
      }
    case 'questions':
      return {
        entityType: 'hazid_assessment_question',
        entityId: rowOp.rowId,
        summary: 'Answered question',
        field: rowOp.field,
      }
  }
}

export const hazardAssessmentRecordSaver = defineRecordSaver<LoadedAssessment>(
  'hazard-assessments',
  {
    authorize: (ctx) => can(ctx, 'hazid.update'),
    async load(tx, requestCtx, assessmentId) {
      if (!requestCtx.tenantId) throw recordNotFound()
      const ctx = requestCtx as HazidCtx
      // Tenant-owned, not deleted, visible to this worker (self/site tier),
      // locked FOR UPDATE for the whole batch.
      const row = await lockVisibleAssessmentRow(ctx, tx, assessmentId)
      if (!row) throw recordNotFound()
      if (row.locked) throw recordLocked(ASSESSMENT_LOCKED_MESSAGE)
      return { ctx, row, hazards: new Map(), ppe: new Map(), questions: new Map() }
    },
    resolve(tx, ctx, loaded, op) {
      const rowOp = parseAssessmentRowOp(op)
      if (rowOp) return resolveRowOp(tx, loaded, rowOp)
      return columnOps(loaded.row, assessmentCodecs(ctx.timezone), (patch) =>
        writeAssessment(tx, loaded, patch),
      )(op)
    },
    async afterWrites(tx, _ctx, loaded, changes) {
      const { ctx, row } = loaded
      for (const change of changes) {
        const entry = auditEntry(row.id, change)
        await recordAuditInTransaction(tx, ctx, {
          entityType: entry.entityType,
          entityId: entry.entityId,
          action: 'update',
          summary: entry.summary,
          before: { [entry.field]: change.before },
          after: { [entry.field]: change.after },
        })
      }
      // An answer can make a conditional embedded app applicable: create its
      // draft response now, exactly as answering a question always has.
      if (changes.some((change) => parseAssessmentRowOp(change.op)?.kind === 'questions')) {
        await createAutoAssessmentApps(tx, {
          ctx,
          tenantId: ctx.tenantId,
          assessmentId: row.id,
          assessmentTypeId: row.assessmentTypeId,
          submittedBy: ctx.membership?.id ?? null,
        })
      }
    },
    revalidate: (assessmentId) => assessmentPaths(assessmentId),
  },
)
