// Shared helpers for the equipment inspections runtime — reference generation,
// criteria materialisation, result computation, and work-order spawning on a
// failed inspection (the legacy "fail = WO" rule).

import { and, eq, isNull, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Database } from '@beaconhs/db'
import type { RequestContext } from '@beaconhs/tenant'
import { recordModuleFlowEvent } from '@beaconhs/events'
import {
  equipmentInspectionCriteria,
  equipmentInspectionGroups,
  equipmentInspectionRecordCriteria,
  equipmentInspectionRecords,
  equipmentInspectionSchedules,
  equipmentItems,
  equipmentWorkOrders,
} from '@beaconhs/db/schema'
import { nextReference } from '@/lib/reference'
import { addInterval } from '@/lib/equipment/intervals'
import { materializeEquipmentTypeEvidence } from '@/lib/compliance-type-evidence'
import { recordAuditInTransaction } from '@/lib/audit'
import { canSeeRecord } from '@/lib/visibility'

type EqAnswer = 'pass' | 'fail' | 'n_a'
type EqSeverity = 'low' | 'medium' | 'high' | 'critical'

const ANSWERS = ['pass', 'fail', 'n_a'] as const
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const

export type EquipmentInspectionTx = Database

async function lockEquipmentInspectionRecordForMutation(
  tx: EquipmentInspectionTx,
  tenantId: string,
  recordId: string,
): Promise<typeof equipmentInspectionRecords.$inferSelect | null> {
  const [record] = await tx
    .select()
    .from(equipmentInspectionRecords)
    .where(
      and(
        eq(equipmentInspectionRecords.tenantId, tenantId),
        eq(equipmentInspectionRecords.id, recordId),
        isNull(equipmentInspectionRecords.deletedAt),
      ),
    )
    .limit(1)
    .for('update')
  return record ?? null
}

export async function lockVisibleEquipmentInspectionForMutation(
  tx: EquipmentInspectionTx,
  ctx: RequestContext,
  recordId: string,
  opts?: { allowFinalized?: boolean },
): Promise<typeof equipmentInspectionRecords.$inferSelect> {
  const record = await lockEquipmentInspectionRecordForMutation(tx, ctx.tenantId, recordId)
  if (!record) throw new Error('Equipment inspection not found')
  const [item] = await tx
    .select({
      currentSiteOrgUnitId: equipmentItems.currentSiteOrgUnitId,
      currentHolderPersonId: equipmentItems.currentHolderPersonId,
    })
    .from(equipmentItems)
    .where(
      and(
        eq(equipmentItems.tenantId, ctx.tenantId),
        eq(equipmentItems.id, record.equipmentItemId),
        isNull(equipmentItems.deletedAt),
      ),
    )
    .limit(1)
  if (!item) throw new Error('Equipment item not found')
  const visible = await canSeeRecord(ctx, tx, {
    prefix: 'equipment',
    ownerIds: [record.inspectorTenantUserId, record.submittedByTenantUserId],
    siteId: record.siteOrgUnitId ?? item.currentSiteOrgUnitId,
    personId: record.inspectorPersonId ?? item.currentHolderPersonId,
  })
  if (!visible) throw new Error('Equipment inspection not found')
  if (
    !opts?.allowFinalized &&
    (record.locked || record.status === 'submitted' || record.status === 'closed')
  ) {
    throw new Error('This equipment inspection is submitted or locked')
  }
  return record
}

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
export async function nextEquipmentInspectionReferenceInTx(
  tx: EquipmentInspectionTx,
  tenantId: string,
  occurredAt: Date,
): Promise<string> {
  return nextReference(tx, tenantId, 'equipment_inspection', occurredAt.getFullYear())
}

/**
 * Materialise equipment_inspection_record_criteria for a new record by walking
 * the type's criteria — group order (ungrouped last), then criterion order —
 * snapshotting the question, group label, kind, default severity, and flags so
 * the fill view renders without joining the live type.
 */
export async function materialiseEquipmentCriteriaInTx(
  tx: EquipmentInspectionTx,
  tenantId: string,
  recordId: string,
  typeId: string,
): Promise<number> {
  const rows = await tx
    .select({
      criterion: equipmentInspectionCriteria,
      groupLabel: equipmentInspectionGroups.label,
    })
    .from(equipmentInspectionCriteria)
    .leftJoin(
      equipmentInspectionGroups,
      and(
        eq(equipmentInspectionGroups.tenantId, equipmentInspectionCriteria.tenantId),
        eq(equipmentInspectionGroups.id, equipmentInspectionCriteria.groupId),
      ),
    )
    .where(
      and(
        eq(equipmentInspectionCriteria.tenantId, tenantId),
        eq(equipmentInspectionCriteria.inspectionTypeId, typeId),
      ),
    )
    .orderBy(
      sql`coalesce(${equipmentInspectionGroups.sequence}, 2147483647)`,
      equipmentInspectionCriteria.sequence,
      equipmentInspectionCriteria.id,
    )
  if (rows.length === 0) return 0
  await tx.insert(equipmentInspectionRecordCriteria).values(
    rows.map((r, i) => ({
      tenantId,
      recordId,
      criterionId: r.criterion.id,
      questionTextSnapshot: r.criterion.question,
      groupLabelSnapshot: r.groupLabel ?? null,
      kind: r.criterion.kind,
      isRequired: r.criterion.isRequired,
      // Carry the template's severity as the default a fail inherits.
      severity: r.criterion.severity,
      requiresPhoto: r.criterion.requiresPhoto,
      requiresComment: r.criterion.requiresComment,
      isCritical: r.criterion.isCritical,
      sequence: i,
    })),
  )
  return rows.length
}

type SubmitOutcome =
  | {
      ok: true
      result: 'pass' | 'fail'
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
    const record = await lockVisibleEquipmentInspectionForMutation(tx, ctx, recordId)

    // The item lock serializes schedule advancement with schedule editing and
    // type/status changes. Compliance is refreshed from this exact snapshot.
    const [item] = await tx
      .select({ typeId: equipmentItems.typeId })
      .from(equipmentItems)
      .where(
        and(
          eq(equipmentItems.tenantId, ctx.tenantId),
          eq(equipmentItems.id, record.equipmentItemId),
          isNull(equipmentItems.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (!item) return { ok: false, error: 'Equipment item not found.' }

    const rows = await tx
      .select()
      .from(equipmentInspectionRecordCriteria)
      .where(
        and(
          eq(equipmentInspectionRecordCriteria.tenantId, ctx.tenantId),
          eq(equipmentInspectionRecordCriteria.recordId, recordId),
        ),
      )

    if (rows.length === 0) {
      return { ok: false, error: 'Cannot submit an inspection with no checklist items.' }
    }

    const hasValue = (row: (typeof rows)[number]) => {
      if (row.kind === 'pass_fail' || row.kind === 'pass_fail_na') return row.answer != null
      if (row.kind === 'text') return (row.textValue ?? '').trim() !== ''
      if (row.kind === 'numeric') return row.numericValue != null
      return Array.isArray(row.photoAttachmentIds) && row.photoAttachmentIds.length > 0
    }
    const missingRequired = rows.filter((row) => row.isRequired && !hasValue(row))
    if (missingRequired.length > 0) {
      return {
        ok: false,
        error: `Cannot submit yet: ${missingRequired.length} required item${missingRequired.length === 1 ? '' : 's'} ${missingRequired.length === 1 ? 'is' : 'are'} unanswered.`,
      }
    }

    const fails: typeof rows = []
    for (const r of rows) {
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

    const result: 'pass' | 'fail' = fails.length > 0 ? 'fail' : 'pass'

    // Spawn work orders for failed criteria (legacy fail = WO). A critical
    // criterion always spawns; otherwise the type-level flag gates it.
    let spawned = 0
    const typeAllowsWo = record.failsSpawnWorkOrders

    for (const f of fails) {
      if (f.workOrderId) continue
      if (!typeAllowsWo && !f.isCritical) continue
      const yr = record.occurredAt.getFullYear()
      const woRef = await nextReference(tx, ctx.tenantId, 'work_order', yr)
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
        .returning({ id: equipmentWorkOrders.id, reference: equipmentWorkOrders.reference })
      if (wo?.id) {
        const [linked] = await tx
          .update(equipmentInspectionRecordCriteria)
          .set({ workOrderId: wo.id })
          .where(
            and(
              eq(equipmentInspectionRecordCriteria.tenantId, ctx.tenantId),
              eq(equipmentInspectionRecordCriteria.recordId, recordId),
              eq(equipmentInspectionRecordCriteria.id, f.id),
            ),
          )
          .returning({ id: equipmentInspectionRecordCriteria.id })
        if (!linked) throw new Error('Failed to link the inspection work order')
        await recordModuleFlowEvent(tx, ctx, {
          subjectId: wo.id,
          moduleKey: 'equipment',
          event: 'on_create',
          occurrenceKey: wo.id,
        })
        await recordAuditInTransaction(tx, ctx, {
          entityType: 'equipment_work_order',
          entityId: wo.id,
          action: 'create',
          summary: `Auto-opened ${wo.reference} from failed equipment inspection ${record.reference}`,
          after: {
            equipmentItemId: record.equipmentItemId,
            inspectionRecordId: record.id,
            criterionRowId: f.id,
            priority:
              f.severity === 'critical' || f.severity === 'high' || f.isCritical ? 'high' : 'med',
          },
        })
        spawned++
      }
    }

    const occurredOn = record.occurredAt.toISOString().slice(0, 10)
    const nextDueOn = nextDueFromInterval(
      record.intervalValue,
      record.intervalUnit,
      record.occurredAt,
    )

    const [submitted] = await tx
      .update(equipmentInspectionRecords)
      .set({
        result,
        status: 'submitted',
        submittedAt: new Date(),
        submittedByTenantUserId: ctx.membership?.id ?? null,
        // Snapshot this record's own inspection date + computed next-due so the
        // upcoming report and compliance engine can read the row directly.
        lastInspectionOn: occurredOn,
        nextDueOn,
      })
      .where(
        and(
          eq(equipmentInspectionRecords.tenantId, ctx.tenantId),
          eq(equipmentInspectionRecords.id, recordId),
          isNull(equipmentInspectionRecords.deletedAt),
        ),
      )
      .returning({ id: equipmentInspectionRecords.id })
    if (!submitted) throw new Error('Equipment inspection changed before it could be submitted')

    // A pre-use template stamps the item's pre-use timestamp; every submitted
    // inspection also advances the item's matching active schedules (per-unit
    // cadences drive overdue tracking, the maintenance cockpit, and compliance
    // signals). Each schedule advances by its OWN interval, from this
    // inspection's date.
    if (record.isPreUse) {
      await tx
        .update(equipmentItems)
        .set({ lastPreUseInspectionAt: record.occurredAt })
        .where(
          and(
            eq(equipmentItems.tenantId, ctx.tenantId),
            eq(equipmentItems.id, record.equipmentItemId),
            isNull(equipmentItems.deletedAt),
          ),
        )
    }
    if (record.inspectionTypeId) {
      const schedules = await tx
        .select()
        .from(equipmentInspectionSchedules)
        .where(
          and(
            eq(equipmentInspectionSchedules.tenantId, ctx.tenantId),
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
          .where(
            and(
              eq(equipmentInspectionSchedules.tenantId, ctx.tenantId),
              eq(equipmentInspectionSchedules.id, s.id),
              eq(equipmentInspectionSchedules.equipmentItemId, record.equipmentItemId),
            ),
          )
      }
    }

    await recordModuleFlowEvent(tx, ctx, {
      subjectId: recordId,
      moduleKey: 'equipment-inspections',
      event: 'on_submit',
      occurrenceKey: randomUUID(),
    })

    await materializeEquipmentTypeEvidence(tx, ctx.tenantId, [item.typeId])

    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment_inspection_record',
      entityId: recordId,
      action: 'update',
      summary: `Submitted — ${result}${spawned ? `, ${spawned} work order(s) opened` : ''}`,
      before: { status: record.status, result: record.result },
      after: { status: 'submitted', result, workOrdersSpawned: spawned },
    })

    return { ok: true, result, failed: fails.length, workOrdersSpawned: spawned }
  })
}
