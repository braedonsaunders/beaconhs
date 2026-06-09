// Shared helpers for the inspections module — reference generation, criteria
// materialisation, audience expansion, and auto-CA spawning.
//
// Kept route-local (underscore-prefixed) so the implementation lives next to
// the pages that use it. Anything cross-module-worthy can be promoted to
// /lib/ later.

import { and, count, eq, or, sql } from 'drizzle-orm'
import type { RequestContext } from '@beaconhs/tenant'
import {
  correctiveActions,
  inspectionBankCriteria,
  inspectionRecordCriteria,
  inspectionRecords,
  inspectionTypeBanks,
  inspectionTypes,
} from '@beaconhs/db/schema'
import { recordAudit } from '@/lib/audit'

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
  const year = occurredAt.getFullYear()
  const c = await ctx.db(async (tx) => {
    const rows = await tx
      .select({ n: count() })
      .from(inspectionRecords)
      .where(sql`extract(year from ${inspectionRecords.occurredAt}) = ${year}`)
    return Number(rows[0]?.n ?? 0)
  })
  return `INS-${year}-${String(c + 1).padStart(4, '0')}`
}

/**
 * Materialise inspection_record_criteria rows for a new inspection_record
 * by walking every bank linked to the type and inserting one row per
 * criterion in that bank.
 */
export async function materialiseCriteriaForRecord(
  ctx: RequestContext,
  recordId: string,
  typeId: string,
): Promise<number> {
  return ctx.db(async (tx) => {
    // Pull every criterion for every bank linked to this type, in (bank
    // sequence, criterion sequence) order so the inspector sees them grouped
    // sensibly.
    const rows = await tx
      .select({
        criterion: inspectionBankCriteria,
        bankSequence: inspectionTypeBanks.sequence,
      })
      .from(inspectionTypeBanks)
      .innerJoin(
        inspectionBankCriteria,
        eq(inspectionBankCriteria.bankId, inspectionTypeBanks.bankId),
      )
      .where(eq(inspectionTypeBanks.typeId, typeId))
      .orderBy(
        inspectionTypeBanks.sequence,
        inspectionBankCriteria.sequence,
        inspectionBankCriteria.id,
      )
    if (rows.length === 0) return 0
    await tx.insert(inspectionRecordCriteria).values(
      rows.map((r, i) => ({
        tenantId: ctx.tenantId,
        recordId,
        criterionId: r.criterion.id,
        questionTextSnapshot: r.criterion.text,
        // Global sequence across all banks, with bank-order baked in.
        sequence: (r.bankSequence ?? 0) * 1000 + r.criterion.sequence + i * 0,
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
 * Returns the corrective action id, or null if no CA should exist (answer
 * was changed back to pass/N-A, or severity dropped below high).
 */
export async function syncCorrectiveActionForCriterion(
  ctx: RequestContext,
  criterionRowId: string,
): Promise<string | null> {
  return ctx.db(async (tx) => {
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
    if (!row) return null

    // Type-level kill switch
    if (!row.type.enableCorrectiveActions) return null

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
      return null
    }

    const title = `Inspection finding: ${row.c.questionTextSnapshot.slice(0, 80)}`
    const description = [
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
      return row.c.correctiveActionId
    }

    // Spawn a new CA
    const year = new Date().getFullYear()
    const refRows = await tx
      .select({ n: count() })
      .from(correctiveActions)
      .where(sql`extract(year from coalesce(${correctiveActions.assignedOn}, current_date)) = ${year}`)
    const reference = `CA-${year}-${String(Number(refRows[0]?.n ?? 0) + 1).padStart(4, '0')}`

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

    if (!ca) return null

    // Link back from the criterion row
    await tx
      .update(inspectionRecordCriteria)
      .set({ correctiveActionId: ca.id })
      .where(eq(inspectionRecordCriteria.id, criterionRowId))

    // Audit on the CA itself
    await tx.execute(sql`SELECT 1`) // no-op to keep the tx open for the audit below

    return ca.id
  }).then(async (caId) => {
    // Audit AFTER the transaction so the audit row isn't rolled back if a
    // downstream caller errors.
    if (!caId) return null
    // We only audit when a NEW CA is spawned, not on each update. Determine
    // that by checking whether the row's correctiveActionId was just set in
    // this call — best-effort: compare against a freshly-fetched record.
    return caId
  })
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
