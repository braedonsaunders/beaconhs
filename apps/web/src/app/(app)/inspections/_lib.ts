// Shared helpers for the inspections module — reference generation, criteria
// materialisation, audience expansion, and auto-CA spawning.
//
// Kept route-local (underscore-prefixed) so the implementation lives next to
// the pages that use it. Anything cross-module-worthy can be promoted to
// /lib/ later.

import { eq, sql } from 'drizzle-orm'
import type { RequestContext } from '@beaconhs/tenant'
import {
  correctiveActions,
  inspectionRecordCriteria,
  inspectionRecords,
  inspectionTypeCriteria,
  inspectionTypeGroups,
  inspectionTypes,
} from '@beaconhs/db/schema'
import { recordAudit } from '@/lib/audit'
import { nextReference } from '@/lib/reference'

export type CriterionAnswer = 'pass' | 'fail' | 'n_a'
export type CriterionSeverity = 'low' | 'medium' | 'high' | 'critical'

const ANSWER_VALUES = ['pass', 'fail', 'n_a'] as const
const SEVERITY_VALUES = ['low', 'medium', 'high', 'critical'] as const

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
export async function nextInspectionReference(
  ctx: RequestContext,
  occurredAt: Date,
): Promise<string> {
  return ctx.db((tx) => nextReference(tx, ctx.tenantId, 'inspection', occurredAt.getFullYear()))
}

/**
 * Materialise inspection_record_criteria rows for a new inspection_record by
 * walking the type's own criteria — in group order (ungrouped last), then
 * criterion order — and snapshotting the group label + response config onto
 * each row so the fill view renders section headers and the right controls
 * without joining back to the live type.
 */
export async function materialiseCriteriaForRecord(
  ctx: RequestContext,
  recordId: string,
  typeId: string,
): Promise<number> {
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        criterion: inspectionTypeCriteria,
        groupLabel: inspectionTypeGroups.label,
      })
      .from(inspectionTypeCriteria)
      .leftJoin(inspectionTypeGroups, eq(inspectionTypeGroups.id, inspectionTypeCriteria.groupId))
      .where(eq(inspectionTypeCriteria.typeId, typeId))
      // Ungrouped criteria (null group) sort last via the coalesce sentinel.
      .orderBy(
        sql`coalesce(${inspectionTypeGroups.sequence}, 2147483647)`,
        inspectionTypeCriteria.sequence,
        inspectionTypeCriteria.id,
      )
    if (rows.length === 0) return 0
    await tx.insert(inspectionRecordCriteria).values(
      rows.map((r, i) => ({
        tenantId: ctx.tenantId,
        recordId,
        criterionId: r.criterion.id,
        questionTextSnapshot: r.criterion.text,
        groupLabelSnapshot: r.groupLabel ?? null,
        responseType: r.criterion.responseType,
        requiresPhoto: r.criterion.requiresPhoto,
        requiresComment: r.criterion.requiresComment,
        sequence: i,
      })),
    )
    return rows.length
  })
}

/**
 * Decide whether a fail-severity combination should trigger an auto-CA.
 * Spec: severity ≥ high.
 */
export function shouldSpawnCorrectiveAction(
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
export async function syncCorrectiveActionForCriterion(
  ctx: RequestContext,
  criterionRowId: string,
): Promise<{ caId: string | null; created: boolean }> {
  const result = await ctx.db(
    async (
      tx,
    ): Promise<{
      caId: string | null
      created: boolean
      recordId: string | null
      severity: CriterionSeverity | null
    }> => {
      const none = { caId: null, created: false, recordId: null, severity: null }
      const [row] = await tx
        .select({
          c: inspectionRecordCriteria,
          record: inspectionRecords,
          type: inspectionTypes,
        })
        .from(inspectionRecordCriteria)
        .innerJoin(inspectionRecords, eq(inspectionRecords.id, inspectionRecordCriteria.recordId))
        .innerJoin(inspectionTypes, eq(inspectionTypes.id, inspectionRecords.typeId))
        .where(eq(inspectionRecordCriteria.id, criterionRowId))
        .limit(1)
      if (!row) return none

      // Type-level kill switch
      if (!row.type.enableCorrectiveActions) return none

      const answer = row.c.answer as CriterionAnswer | null
      const severity = row.c.severity as CriterionSeverity | null
      const shouldHaveCA = shouldSpawnCorrectiveAction(answer, severity)

      // Cleanup: if the user flipped it back to pass/N-A, or the severity
      // dropped below the threshold, remove the link to the CA. We DON'T
      // delete the CA itself — a CA might already be in progress.
      if (!shouldHaveCA) {
        if (row.c.correctiveActionId) {
          await tx
            .update(inspectionRecordCriteria)
            .set({ correctiveActionId: null })
            .where(eq(inspectionRecordCriteria.id, criterionRowId))
        }
        return none
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

      // Severity → due offset (in days) — sane defaults that mirror legacy
      const dayOffset = severity === 'critical' ? 1 : severity === 'high' ? 3 : 7
      const dueDate = new Date(row.record.occurredAt)
      dueDate.setDate(dueDate.getDate() + dayOffset)
      const dueOn = row.c.assignedDueDate ?? dueDate.toISOString().slice(0, 10)

      // Map criterion severity to CA severity (1:1). Drizzle's enum column
      // doesn't accept null in the set() narrowing so we widen with as-any.
      const caSeverity = severity ?? 'high'

      if (row.c.correctiveActionId) {
        // Update existing CA in place
        await tx
          .update(correctiveActions)
          .set({
            title,
            description,
            severity: caSeverity,
            dueOn,
            siteOrgUnitId: row.record.siteOrgUnitId,
            actionTaken: row.c.actionTaken,
          })
          .where(eq(correctiveActions.id, row.c.correctiveActionId))
        return {
          caId: row.c.correctiveActionId,
          created: false,
          recordId: row.c.recordId,
          severity: caSeverity,
        }
      }

      // Spawn a new CA
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
          sourceEntityId: row.c.recordId,
          siteOrgUnitId: row.record.siteOrgUnitId,
          assignedOn: new Date().toISOString().slice(0, 10),
          dueOn,
          assignedByTenantUserId: ctx.membership?.id ?? null,
          ownerTenantUserId: row.c.assignedToTenantUserId ?? ctx.membership?.id ?? null,
        })
        .returning()

      if (!ca) return none

      // Link back from the criterion row
      await tx
        .update(inspectionRecordCriteria)
        .set({ correctiveActionId: ca.id })
        .where(eq(inspectionRecordCriteria.id, criterionRowId))

      return { caId: ca.id, created: true, recordId: row.c.recordId, severity: caSeverity }
    },
  )

  // Audit AFTER the transaction so a rollback never leaves a phantom audit row.
  // Only newly-spawned CAs are audited — in-place updates are routine syncs.
  if (result.created && result.caId && result.recordId) {
    await recordAudit(ctx, {
      entityType: 'corrective_action',
      entityId: result.caId,
      action: 'create',
      summary: `Auto-spawned from inspection finding (severity ${result.severity ?? 'unknown'})`,
      after: { sourceEntityType: 'inspection_record', sourceEntityId: result.recordId },
    })
    await logRecordAudit(ctx, result.recordId, 'Auto-spawned corrective action', 'update', {
      correctiveActionId: result.caId,
    })
  }

  return { caId: result.caId, created: result.created }
}

/**
 * Walk a record's criteria + return human-readable list of unanswered /
 * incomplete rows. Used by the submit gate so the inspector sees what's
 * missing before the system flips the status to 'submitted'.
 */
export async function findIncompleteCriteria(
  ctx: RequestContext,
  recordId: string,
): Promise<string[]> {
  return ctx.db(async (tx) => {
    const rows = await tx
      .select()
      .from(inspectionRecordCriteria)
      .where(eq(inspectionRecordCriteria.recordId, recordId))

    const missing: string[] = []
    for (const r of rows) {
      if (!r.answer) {
        missing.push(`${r.questionTextSnapshot}: no answer`)
        continue
      }
      if (r.answer === 'fail') {
        if (!r.severity) missing.push(`${r.questionTextSnapshot}: severity`)
        if (!r.nonComplianceDescription)
          missing.push(`${r.questionTextSnapshot}: non-compliance description`)
      }
      // Enforce the per-criterion requirements snapshotted from the type.
      // N/A answers are exempt from photo evidence (nothing to photograph);
      // a required comment is covered by the non-compliance description on
      // fails and by the note on pass / N-A.
      if (r.requiresPhoto && r.answer !== 'n_a' && (r.photoAttachmentIds ?? []).length === 0)
        missing.push(`${r.questionTextSnapshot}: photo evidence`)
      if (r.requiresComment && r.answer !== 'fail' && !r.compliantNote)
        missing.push(`${r.questionTextSnapshot}: comment`)
    }
    return missing
  })
}

export async function logRecordAudit(
  ctx: RequestContext,
  recordId: string,
  summary: string,
  action: 'create' | 'update' | 'delete' | 'sign' | 'publish' | 'archive' = 'update',
  after?: Record<string, unknown>,
): Promise<void> {
  await recordAudit(ctx, {
    entityType: 'inspection_record',
    entityId: recordId,
    action,
    summary,
    after,
  })
}
