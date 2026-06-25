'use server'

// Server actions for the equipment inspection TYPE builder (1/3-2/3). A type
// owns its criteria directly, organised into drag-reorderable sections. Mirrors
// the inspections type builder, with equipment's richer criterion model
// (kind / severity / required / critical) and no banks/publish.
//
// These take typed object args (not FormData) — the builder is a client
// component that calls them imperatively inside a transition.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  equipmentInspectionCriteria,
  equipmentInspectionGroups,
  equipmentInspectionTypes,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'

const KINDS = ['pass_fail', 'pass_fail_na', 'text', 'numeric', 'photo'] as const
type Kind = (typeof KINDS)[number]
function parseKind(v: unknown): Kind {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v) ? (v as Kind) : 'pass_fail'
}

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
type Severity = (typeof SEVERITIES)[number]
function parseSeverity(v: unknown): Severity {
  return typeof v === 'string' && (SEVERITIES as readonly string[]).includes(v)
    ? (v as Severity)
    : 'medium'
}

const INTERVALS = [
  'pre_use',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'annually',
  'five_year',
  'on_demand',
] as const
type Interval = (typeof INTERVALS)[number]
function parseInterval(v: unknown): Interval {
  return typeof v === 'string' && (INTERVALS as readonly string[]).includes(v)
    ? (v as Interval)
    : 'on_demand'
}

async function manageCtx() {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'equipment')
  return ctx
}

function revalidateType(id: string) {
  revalidatePath(`/equipment/inspection-types/${id}`)
  revalidatePath('/equipment/inspection-types')
}

// --- type settings ---------------------------------------------------------

export async function updateEquipmentInspectionType(input: {
  id: string
  name: string
  description: string | null
  interval: string
  appliesToTypeId: string | null
  allowPassAll: boolean
  failsSpawnWorkOrders: boolean
  isActive: boolean
}) {
  const ctx = await manageCtx()
  const name = input.name.trim()
  if (!name) throw new Error('Name is required')
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionTypes)
      .set({
        name,
        description: input.description?.trim() || null,
        interval: parseInterval(input.interval),
        appliesToTypeId: input.appliesToTypeId || null,
        allowPassAll: input.allowPassAll,
        failsSpawnWorkOrders: input.failsSpawnWorkOrders,
        isActive: input.isActive,
      })
      .where(eq(equipmentInspectionTypes.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'equipment_inspection_type',
    entityId: input.id,
    action: 'update',
    summary: 'Type details updated',
  })
  revalidateType(input.id)
}

export async function deleteEquipmentInspectionType(input: { id: string }) {
  const ctx = await manageCtx()
  // Hard delete — criteria + groups cascade; historical records keep their
  // snapshot and have inspection_type_id set null by the FK.
  await ctx.db((tx) =>
    tx.delete(equipmentInspectionTypes).where(eq(equipmentInspectionTypes.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'equipment_inspection_type',
    entityId: input.id,
    action: 'delete',
    summary: 'Deleted equipment inspection type',
  })
  revalidatePath('/equipment/inspection-types')
}

// --- groups (sections) -----------------------------------------------------

export async function addTypeGroup(input: { typeId: string; label?: string }) {
  const ctx = await manageCtx()
  const id = await ctx.db(async (tx) => {
    const [maxRow] = await tx
      .select({
        m: sql<number>`coalesce(max(${equipmentInspectionGroups.sequence}), -1)`.mapWith(Number),
      })
      .from(equipmentInspectionGroups)
      .where(eq(equipmentInspectionGroups.inspectionTypeId, input.typeId))
    const [row] = await tx
      .insert(equipmentInspectionGroups)
      .values({
        tenantId: ctx.tenantId,
        inspectionTypeId: input.typeId,
        sequence: Number(maxRow?.m ?? -1) + 1,
        label: input.label?.trim() || 'New section',
      })
      .returning({ id: equipmentInspectionGroups.id })
    return row?.id
  })
  await recordAudit(ctx, {
    entityType: 'equipment_inspection_type',
    entityId: input.typeId,
    action: 'update',
    summary: 'Added a criteria section',
  })
  revalidateType(input.typeId)
  return { id }
}

export async function renameTypeGroup(input: { typeId: string; id: string; label: string }) {
  const ctx = await manageCtx()
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionGroups)
      .set({ label: input.label.trim() || 'Section' })
      .where(eq(equipmentInspectionGroups.id, input.id)),
  )
  revalidateType(input.typeId)
}

export async function deleteTypeGroup(input: { typeId: string; id: string }) {
  const ctx = await manageCtx()
  await ctx.db(async (tx) => {
    // Keep the criteria — move them back to "ungrouped".
    await tx
      .update(equipmentInspectionCriteria)
      .set({ groupId: null })
      .where(eq(equipmentInspectionCriteria.groupId, input.id))
    await tx.delete(equipmentInspectionGroups).where(eq(equipmentInspectionGroups.id, input.id))
  })
  await recordAudit(ctx, {
    entityType: 'equipment_inspection_type',
    entityId: input.typeId,
    action: 'update',
    summary: 'Removed a criteria section',
  })
  revalidateType(input.typeId)
}

export async function reorderTypeGroups(input: { typeId: string; ids: string[] }) {
  const ctx = await manageCtx()
  await ctx.db(async (tx) => {
    for (let i = 0; i < input.ids.length; i++) {
      await tx
        .update(equipmentInspectionGroups)
        .set({ sequence: i })
        .where(eq(equipmentInspectionGroups.id, input.ids[i]!))
    }
  })
  revalidateType(input.typeId)
}

// --- criteria --------------------------------------------------------------

type CriterionInput = {
  question: string
  description: string | null
  kind: string
  severity: string
  requiresPhoto: boolean
  requiresComment: boolean
  isRequired: boolean
  isCritical: boolean
  groupId: string | null
}

export async function addTypeCriterion(input: { typeId: string } & CriterionInput) {
  const ctx = await manageCtx()
  const question = input.question.trim()
  if (!question) throw new Error('Question is required')
  const id = await ctx.db(async (tx) => {
    const [maxRow] = await tx
      .select({
        m: sql<number>`coalesce(max(${equipmentInspectionCriteria.sequence}), -1)`.mapWith(Number),
      })
      .from(equipmentInspectionCriteria)
      .where(
        and(
          eq(equipmentInspectionCriteria.inspectionTypeId, input.typeId),
          input.groupId
            ? eq(equipmentInspectionCriteria.groupId, input.groupId)
            : isNull(equipmentInspectionCriteria.groupId),
        ),
      )
    const [row] = await tx
      .insert(equipmentInspectionCriteria)
      .values({
        tenantId: ctx.tenantId,
        inspectionTypeId: input.typeId,
        groupId: input.groupId,
        sequence: Number(maxRow?.m ?? -1) + 1,
        question,
        description: input.description?.trim() || null,
        kind: parseKind(input.kind),
        severity: parseSeverity(input.severity),
        requiresPhoto: Boolean(input.requiresPhoto),
        requiresComment: Boolean(input.requiresComment),
        isRequired: Boolean(input.isRequired),
        isCritical: Boolean(input.isCritical),
      })
      .returning({ id: equipmentInspectionCriteria.id })
    return row?.id
  })
  await recordAudit(ctx, {
    entityType: 'equipment_inspection_type',
    entityId: input.typeId,
    action: 'update',
    summary: `Added criterion: "${question.slice(0, 60)}"`,
  })
  revalidateType(input.typeId)
  return { id }
}

export async function updateTypeCriterion(
  input: { typeId: string; id: string } & Partial<CriterionInput>,
) {
  const ctx = await manageCtx()
  await ctx.db(async (tx) => {
    const patch: Record<string, unknown> = {}
    if (input.question !== undefined) patch.question = input.question.trim() || 'Criterion'
    if (input.description !== undefined) patch.description = input.description?.trim() || null
    if (input.kind !== undefined) patch.kind = parseKind(input.kind)
    if (input.severity !== undefined) patch.severity = parseSeverity(input.severity)
    if (input.requiresPhoto !== undefined) patch.requiresPhoto = input.requiresPhoto
    if (input.requiresComment !== undefined) patch.requiresComment = input.requiresComment
    if (input.isRequired !== undefined) patch.isRequired = input.isRequired
    if (input.isCritical !== undefined) patch.isCritical = input.isCritical
    // Moving to a different group appends to the end of that group.
    if (input.groupId !== undefined) {
      const [cur] = await tx
        .select({ groupId: equipmentInspectionCriteria.groupId })
        .from(equipmentInspectionCriteria)
        .where(eq(equipmentInspectionCriteria.id, input.id))
        .limit(1)
      if (cur && (cur.groupId ?? null) !== (input.groupId ?? null)) {
        const [maxRow] = await tx
          .select({
            m: sql<number>`coalesce(max(${equipmentInspectionCriteria.sequence}), -1)`.mapWith(
              Number,
            ),
          })
          .from(equipmentInspectionCriteria)
          .where(
            and(
              eq(equipmentInspectionCriteria.inspectionTypeId, input.typeId),
              input.groupId
                ? eq(equipmentInspectionCriteria.groupId, input.groupId)
                : isNull(equipmentInspectionCriteria.groupId),
            ),
          )
        patch.groupId = input.groupId
        patch.sequence = Number(maxRow?.m ?? -1) + 1
      }
    }
    if (Object.keys(patch).length > 0) {
      await tx
        .update(equipmentInspectionCriteria)
        .set(patch)
        .where(eq(equipmentInspectionCriteria.id, input.id))
    }
  })
  revalidateType(input.typeId)
}

export async function deleteTypeCriterion(input: { typeId: string; id: string }) {
  const ctx = await manageCtx()
  await ctx.db((tx) =>
    tx.delete(equipmentInspectionCriteria).where(eq(equipmentInspectionCriteria.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'equipment_inspection_type',
    entityId: input.typeId,
    action: 'update',
    summary: 'Removed a criterion',
  })
  revalidateType(input.typeId)
}

export async function reorderTypeCriteria(input: {
  typeId: string
  groupId: string | null
  ids: string[]
}) {
  const ctx = await manageCtx()
  await ctx.db(async (tx) => {
    for (let i = 0; i < input.ids.length; i++) {
      await tx
        .update(equipmentInspectionCriteria)
        .set({ sequence: i, groupId: input.groupId })
        .where(eq(equipmentInspectionCriteria.id, input.ids[i]!))
    }
  })
  revalidateType(input.typeId)
}
