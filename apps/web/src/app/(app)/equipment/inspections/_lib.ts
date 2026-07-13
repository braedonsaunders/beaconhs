// Shared helpers for the equipment inspections runtime — reference generation,
// criteria materialisation, result computation, and work-order spawning on a
// failed inspection (the legacy "fail = WO" rule).

import { and, count, eq, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { RequestContext } from '@beaconhs/tenant'
import { recordModuleFlowEvent } from '@beaconhs/events'
import {
  equipmentInspectionCriteria,
  equipmentInspectionGroups,
  equipmentInspectionRecordCriteria,
  equipmentInspectionRecords,
  equipmentInspectionSchedules,
  equipmentInspectionTypes,
  equipmentItems,
  equipmentWorkOrders,
} from '@beaconhs/db/schema'
import { nextReference } from '@/lib/reference'
import { addInterval } from '@/lib/equipment/intervals'

type EqAnswer = 'pass' | 'fail' | 'n_a'
type EqSeverity = 'low' | 'medium' | 'high' | 'critical'

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

/** Next sequential reference EQI-YYYY-NNNN, keyed to the occurred-at year. */
export async function nextEquipmentInspectionReference(
  ctx: RequestContext,
  occurredAt: Date,
): Promise<string> {
  return ctx.db((tx) =>
    nextReference(tx, ctx.tenantId, 'equipment_inspection', occurredAt.getFullYear()),
  )
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

type SubmitOutcome =
  | {
      ok: true
      result: 'pass' | 'fail' | 'incomplete'
      failed: number
      workOrdersSpawned: number
    }
  | { ok: false; error: string }

/** Next-due date (YYYY-MM-DD) for a value+unit cadence (null = no cadence). */
function nextDueFromInterval(
  intervalValue: number | null,
  intervalUnit: 'day' | 'week' | 'month' | 'year' | null,
  occurredAt: Date,
): string | null {
  if (!intervalValue || !intervalUnit) return null
  return addInterval(occurredAt, intervalValue, intervalUnit)
}

/**
 * Compute a record's result from its answers and, when the type spawns work
 * orders, open one per failed criterion (critical fails always spawn). Blocks
 * submission when a failed criterion is missing evidence its template demands
 * (requiresComment / requiresPhoto). On success it stamps the record's
 * last/next inspection dates AND the equipment item's pre-use / annual
 * inspection columns so overdue tracking reflects performed inspections.
 * Idempotent on work orders via the per-criterion work_order_id pointer.
 */
export async function finaliseEquipmentInspection(
  ctx: RequestContext,
  recordId: string,
): Promise<SubmitOutcome> {
  return ctx.db(async (tx): Promise<SubmitOutcome> => {
    const [record] = await tx
      .select()
      .from(equipmentInspectionRecords)
      .where(eq(equipmentInspectionRecords.id, recordId))
      .limit(1)
    if (!record) return { ok: false, error: 'Inspection record not found.' }
    if (record.status === 'submitted' || record.status === 'closed') {
      return { ok: false, error: 'This inspection is already submitted.' }
    }

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

    // Failed criteria must carry the evidence their template demands.
    const missingComment = fails.filter((f) => f.requiresComment && !(f.comment ?? '').trim())
    const missingPhoto = fails.filter(
      (f) => f.requiresPhoto && (f.photoAttachmentIds?.length ?? 0) === 0,
    )
    if (missingComment.length > 0 || missingPhoto.length > 0) {
      const parts: string[] = []
      if (missingComment.length > 0) {
        parts.push(
          `${missingComment.length} failed item${missingComment.length === 1 ? '' : 's'} need${missingComment.length === 1 ? 's' : ''} a comment`,
        )
      }
      if (missingPhoto.length > 0) {
        parts.push(
          `${missingPhoto.length} failed item${missingPhoto.length === 1 ? '' : 's'} need${missingPhoto.length === 1 ? 's' : ''} a photo`,
        )
      }
      return { ok: false, error: `Cannot submit yet: ${parts.join(' and ')}.` }
    }

    const result: 'pass' | 'fail' | 'incomplete' =
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

    const occurredOn = record.occurredAt.toISOString().slice(0, 10)
    const nextDueOn = nextDueFromInterval(
      typeRow?.intervalValue ?? null,
      typeRow?.intervalUnit ?? null,
      record.occurredAt,
    )

    await tx
      .update(equipmentInspectionRecords)
      .set({
        result,
        status: 'submitted',
        submittedAt: new Date(),
        submittedByTenantUserId: ctx.membership?.id ?? null,
        // Snapshot this record's own inspection date + computed next-due so the
        // upcoming report and compliance engine can read the row directly.
        lastInspectionOn: record.lastInspectionOn ?? occurredOn,
        nextDueOn,
      })
      .where(eq(equipmentInspectionRecords.id, recordId))

    // A pre-use template stamps the item's pre-use timestamp; every submitted
    // inspection also advances the item's matching active schedules (per-unit
    // cadences drive overdue tracking, the maintenance cockpit, and compliance
    // signals). Each schedule advances by its OWN interval, from this
    // inspection's date.
    if (typeRow?.isPreUse) {
      await tx
        .update(equipmentItems)
        .set({ lastPreUseInspectionAt: record.occurredAt })
        .where(eq(equipmentItems.id, record.equipmentItemId))
    }
    if (record.inspectionTypeId) {
      const schedules = await tx
        .select()
        .from(equipmentInspectionSchedules)
        .where(
          and(
            eq(equipmentInspectionSchedules.equipmentItemId, record.equipmentItemId),
            eq(equipmentInspectionSchedules.inspectionTypeId, record.inspectionTypeId),
            eq(equipmentInspectionSchedules.isActive, true),
          ),
        )
      for (const s of schedules) {
        await tx
          .update(equipmentInspectionSchedules)
          .set({
            lastCompletedOn: occurredOn,
            nextDueOn: addInterval(record.occurredAt, s.intervalValue, s.intervalUnit),
            updatedAt: new Date(),
          })
          .where(eq(equipmentInspectionSchedules.id, s.id))
      }
    }

    await recordModuleFlowEvent(tx, ctx, {
      subjectId: recordId,
      moduleKey: 'equipment-inspections',
      event: 'on_submit',
      occurrenceKey: randomUUID(),
    })

    return { ok: true, result, failed: fails.length, workOrdersSpawned: spawned }
  })
}
