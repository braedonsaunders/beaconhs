// Shared helpers for the equipment inspections runtime — reference generation,
// criteria materialisation, result computation, and work-order spawning on a
// failed inspection (the legacy "fail = WO" rule).

import { and, count, eq, sql } from 'drizzle-orm'
import type { RequestContext } from '@beaconhs/tenant'
import {
  equipmentInspectionCriteria,
  equipmentInspectionGroups,
  equipmentInspectionRecordCriteria,
  equipmentInspectionRecords,
  equipmentInspectionTypes,
  equipmentWorkOrders,
} from '@beaconhs/db/schema'

export type EqAnswer = 'pass' | 'fail' | 'n_a'
export type EqSeverity = 'low' | 'medium' | 'high' | 'critical'

const ANSWERS = ['pass', 'fail', 'n_a'] as const
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const

export function parseEqAnswer(raw: unknown): EqAnswer | null {
  return typeof raw === 'string' && (ANSWERS as readonly string[]).includes(raw)
    ? (raw as EqAnswer)
    : null
}
export function parseEqSeverity(raw: unknown): EqSeverity | null {
  return typeof raw === 'string' && (SEVERITIES as readonly string[]).includes(raw)
    ? (raw as EqSeverity)
    : null
}

/** Next sequential reference EQI-YYYY-NNNN, counted by occurred-at year. */
export async function nextEquipmentInspectionReference(
  ctx: RequestContext,
  occurredAt: Date,
): Promise<string> {
  const year = occurredAt.getFullYear()
  const c = await ctx.db(async (tx) => {
    const rows = await tx
      .select({ n: count() })
      .from(equipmentInspectionRecords)
      .where(sql`extract(year from ${equipmentInspectionRecords.occurredAt}) = ${year}`)
    return Number(rows[0]?.n ?? 0)
  })
  return `EQI-${year}-${String(c + 1).padStart(4, '0')}`
}

/**
 * Materialise equipment_inspection_record_criteria for a new record by walking
 * the type's criteria — group order (ungrouped last), then criterion order —
 * snapshotting the question, group label, kind, default severity, and flags so
 * the fill view renders without joining the live type.
 */
export async function materialiseEquipmentCriteria(
  ctx: RequestContext,
  recordId: string,
  typeId: string,
): Promise<number> {
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        criterion: equipmentInspectionCriteria,
        groupLabel: equipmentInspectionGroups.label,
      })
      .from(equipmentInspectionCriteria)
      .leftJoin(
        equipmentInspectionGroups,
        eq(equipmentInspectionGroups.id, equipmentInspectionCriteria.groupId),
      )
      .where(eq(equipmentInspectionCriteria.inspectionTypeId, typeId))
      .orderBy(
        sql`coalesce(${equipmentInspectionGroups.sequence}, 2147483647)`,
        equipmentInspectionCriteria.sequence,
        equipmentInspectionCriteria.id,
      )
    if (rows.length === 0) return 0
    await tx.insert(equipmentInspectionRecordCriteria).values(
      rows.map((r, i) => ({
        tenantId: ctx.tenantId,
        recordId,
        criterionId: r.criterion.id,
        questionTextSnapshot: r.criterion.question,
        groupLabelSnapshot: r.groupLabel ?? null,
        kind: r.criterion.kind,
        // Carry the template's severity as the default a fail inherits.
        severity: r.criterion.severity,
        requiresPhoto: r.criterion.requiresPhoto,
        requiresComment: r.criterion.requiresComment,
        isCritical: r.criterion.isCritical,
        sequence: i,
      })),
    )
    return rows.length
  })
}

export type SubmitOutcome = {
  result: 'pass' | 'fail' | 'incomplete'
  failed: number
  workOrdersSpawned: number
}

/**
 * Compute a record's result from its answers and, when the type spawns work
 * orders, open one per failed criterion (critical fails always spawn). Returns
 * the result + counts. Idempotent on work orders via the per-criterion
 * work_order_id pointer.
 */
export async function finaliseEquipmentInspection(
  ctx: RequestContext,
  recordId: string,
): Promise<SubmitOutcome> {
  return ctx.db(async (tx) => {
    const [record] = await tx
      .select()
      .from(equipmentInspectionRecords)
      .where(eq(equipmentInspectionRecords.id, recordId))
      .limit(1)
    if (!record) return { result: 'incomplete', failed: 0, workOrdersSpawned: 0 }

    const rows = await tx
      .select()
      .from(equipmentInspectionRecordCriteria)
      .where(eq(equipmentInspectionRecordCriteria.recordId, recordId))

    let answered = 0
    const fails: typeof rows = []
    for (const r of rows) {
      // photo/text/numeric kinds count as "answered" once they carry a value
      const hasValue =
        r.answer != null ||
        (r.textValue ?? '') !== '' ||
        r.numericValue != null ||
        (Array.isArray(r.photoAttachmentIds) && r.photoAttachmentIds.length > 0)
      if (hasValue) answered++
      if (r.answer === 'fail') fails.push(r)
    }

    const result: SubmitOutcome['result'] =
      fails.length > 0 ? 'fail' : answered >= rows.length ? 'pass' : 'incomplete'

    // Spawn work orders for failed criteria (legacy fail = WO). A critical
    // criterion always spawns; otherwise the type-level flag gates it.
    let spawned = 0
    const typeRow = record.inspectionTypeId
      ? (
          await tx
            .select()
            .from(equipmentInspectionTypes)
            .where(eq(equipmentInspectionTypes.id, record.inspectionTypeId))
            .limit(1)
        )[0]
      : null
    const typeAllowsWo = typeRow?.failsSpawnWorkOrders ?? true

    for (const f of fails) {
      if (f.workOrderId) continue
      if (!typeAllowsWo && !f.isCritical) continue
      const yr = record.occurredAt.getFullYear()
      const woCountRows = await tx
        .select({ n: count() })
        .from(equipmentWorkOrders)
        .where(sql`extract(year from coalesce(${equipmentWorkOrders.openedAt}, now())) = ${yr}`)
      const woRef = `WO-${yr}-${String(Number(woCountRows[0]?.n ?? 0) + 1 + spawned).padStart(4, '0')}`
      const [wo] = await tx
        .insert(equipmentWorkOrders)
        .values({
          tenantId: ctx.tenantId,
          itemId: record.equipmentItemId,
          reference: woRef,
          summary: `Inspection fail: ${f.questionTextSnapshot.slice(0, 80)}`,
          description: f.comment ?? f.questionTextSnapshot,
          priority:
            f.severity === 'critical' || f.severity === 'high' || f.isCritical ? 'high' : 'med',
          status: 'open',
          openedByTenantUserId: ctx.membership?.id ?? null,
        })
        .returning({ id: equipmentWorkOrders.id })
      if (wo?.id) {
        await tx
          .update(equipmentInspectionRecordCriteria)
          .set({ workOrderId: wo.id })
          .where(eq(equipmentInspectionRecordCriteria.id, f.id))
        spawned++
      }
    }

    await tx
      .update(equipmentInspectionRecords)
      .set({
        result,
        status: 'submitted',
        submittedAt: new Date(),
        submittedByTenantUserId: ctx.membership?.id ?? null,
      })
      .where(eq(equipmentInspectionRecords.id, recordId))

    // Stamp the item's last/next inspection dates from the interval snapshot.
    await tx
      .update(equipmentInspectionRecords)
      .set({ lastInspectionOn: record.occurredAt.toISOString().slice(0, 10) })
      .where(
        and(
          eq(equipmentInspectionRecords.id, recordId),
          sql`${equipmentInspectionRecords.lastInspectionOn} is null`,
        ),
      )

    return { result, failed: fails.length, workOrdersSpawned: spawned }
  })
}
