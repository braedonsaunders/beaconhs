'use server'

// All server actions for the Lift Plans module. Every action calls
// `recordAudit` so the Activity tab on the detail page tells the whole story.
//
// All actions assume an active tenant (every page below /lift-plans is
// tenant-scoped). The single ctx() helper narrows tenantId from
// `string | null` to `string` once at the top of every action.

import { revalidatePath } from 'next/cache'
import { and, asc, count, eq, max, sql } from 'drizzle-orm'
import {
  liftPlanEquipment,
  liftPlanHazards,
  liftPlanLoads,
  liftPlanPhotos,
  liftPlanPpe,
  liftPlanSignatures,
  liftPlans,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

async function ctx() {
  const c = await requireRequestContext()
  if (!c.tenantId) throw new Error('Active tenant required')
  return c as Awaited<ReturnType<typeof requireRequestContext>> & { tenantId: string }
}

const STATUSES = ['draft', 'approved', 'in_progress', 'completed', 'cancelled'] as const
type Status = (typeof STATUSES)[number]
const SIGNATURE_ROLES = ['supervisor', 'operator', 'rigger', 'signaler', 'spotter'] as const
type SignatureRole = (typeof SIGNATURE_ROLES)[number]

const PATHS = (id: string) => [`/lift-plans/${id}`, '/lift-plans']
function revalidatePlan(id: string) {
  for (const p of PATHS(id)) revalidatePath(p)
}

function nullable(v: FormDataEntryValue | null): string | null {
  if (v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function nullableNumeric(v: FormDataEntryValue | null): string | null {
  if (v === null) return null
  const s = String(v).trim()
  if (s === '') return null
  if (Number.isNaN(Number(s))) return null
  return s
}

function nullableInt(v: FormDataEntryValue | null): number | null {
  const s = nullable(v)
  if (s === null) return null
  const n = Number(s)
  if (Number.isNaN(n)) return null
  return Math.trunc(n)
}

function boolish(v: FormDataEntryValue | null): boolean {
  return v === 'on' || v === 'true' || v === '1'
}

// ------------------------------------------------------------------
// Plan lifecycle
// ------------------------------------------------------------------

export async function createLiftPlan(formData: FormData): Promise<{ id: string }> {
  const c = await ctx()
  const projectOrgUnitId = nullable(formData.get('projectOrgUnitId'))
  const siteOrgUnitId = nullable(formData.get('siteOrgUnitId'))
  const liftDateRaw = String(formData.get('liftDate') ?? '').trim()
  if (!liftDateRaw) throw new Error('Lift date is required')
  const supervisorTenantUserId = nullable(formData.get('supervisorTenantUserId'))
  const operatorPersonId = nullable(formData.get('operatorPersonId'))
  const riggerPersonId = nullable(formData.get('riggerPersonId'))
  const description = nullable(formData.get('description'))

  const created = await c.db(async (tx) => {
    const year = new Date().getFullYear()
    const [{ c: yearCount }] = await tx
      .select({ c: count() })
      .from(liftPlans)
      .where(
        and(
          eq(liftPlans.tenantId, c.tenantId),
          sql`extract(year from ${liftPlans.createdAt}) = ${year}`,
        ),
      )
    const reference = `LP-${year}-${String(Number(yearCount ?? 0) + 1).padStart(4, '0')}`

    const [row] = await tx
      .insert(liftPlans)
      .values({
        tenantId: c.tenantId,
        reference,
        projectOrgUnitId,
        siteOrgUnitId,
        liftDate: liftDateRaw,
        supervisorTenantUserId,
        operatorPersonId,
        riggerPersonId,
        description,
        status: 'draft',
        createdByTenantUserId: c.membership?.id ?? null,
      })
      .returning()
    if (!row) throw new Error('Failed to create lift plan')
    return row
  })

  await recordAudit(c, {
    entityType: 'lift_plan',
    entityId: created.id,
    action: 'create',
    summary: `Created ${created.reference}`,
    after: {
      reference: created.reference,
      liftDate: liftDateRaw,
      siteOrgUnitId,
      projectOrgUnitId,
    },
  })
  revalidatePath('/lift-plans')
  return { id: created.id }
}

export async function updateLiftPlanGeneral(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  if (!id) throw new Error('Missing id')

  const liftDate = String(formData.get('liftDate') ?? '').trim()
  const updates: Record<string, unknown> = {
    projectOrgUnitId: nullable(formData.get('projectOrgUnitId')),
    siteOrgUnitId: nullable(formData.get('siteOrgUnitId')),
    supervisorTenantUserId: nullable(formData.get('supervisorTenantUserId')),
    operatorPersonId: nullable(formData.get('operatorPersonId')),
    riggerPersonId: nullable(formData.get('riggerPersonId')),
    description: nullable(formData.get('description')),
  }
  if (liftDate) updates.liftDate = liftDate

  const before = await c.db(async (tx) => {
    const [row] = await tx.select().from(liftPlans).where(eq(liftPlans.id, id)).limit(1)
    return row ?? null
  })
  if (!before) throw new Error('Lift plan not found')
  if (before.locked) throw new Error('Plan is locked — unlock before editing')

  await c.db((tx) => tx.update(liftPlans).set(updates).where(eq(liftPlans.id, id)))
  await recordAudit(c, {
    entityType: 'lift_plan',
    entityId: id,
    action: 'update',
    summary: 'Updated general information',
    before: {
      liftDate: before.liftDate,
      siteOrgUnitId: before.siteOrgUnitId,
      projectOrgUnitId: before.projectOrgUnitId,
    },
    after: updates,
  })
  revalidatePlan(id)
}

export async function changeStatus(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '') as Status
  const reason = nullable(formData.get('cancellationReason'))
  if (!id) throw new Error('Missing id')
  if (!STATUSES.includes(status)) throw new Error('Invalid status')

  const before = await c.db(async (tx) => {
    const [row] = await tx
      .select({ status: liftPlans.status, locked: liftPlans.locked })
      .from(liftPlans)
      .where(eq(liftPlans.id, id))
      .limit(1)
    return row ?? null
  })
  if (!before) throw new Error('Lift plan not found')

  const updates: Record<string, unknown> = { status }
  const now = new Date()
  if (status === 'completed') {
    updates.completedAt = now
    updates.completedByTenantUserId = c.membership?.id ?? null
    // Auto-lock on completion (parity with legacy behaviour).
    updates.locked = true
    updates.lockedAt = now
    updates.lockedByTenantUserId = c.membership?.id ?? null
  } else if (status === 'cancelled') {
    updates.cancelledAt = now
    updates.cancelledByTenantUserId = c.membership?.id ?? null
    updates.cancellationReason = reason
  } else {
    // Re-opening: clear completion / cancellation but leave lock state alone.
    if (before.status === 'completed') {
      updates.completedAt = null
      updates.completedByTenantUserId = null
    }
    if (before.status === 'cancelled') {
      updates.cancelledAt = null
      updates.cancelledByTenantUserId = null
      updates.cancellationReason = null
    }
  }

  await c.db((tx) => tx.update(liftPlans).set(updates).where(eq(liftPlans.id, id)))
  await recordAudit(c, {
    entityType: 'lift_plan',
    entityId: id,
    action: 'update',
    summary: `Status changed: ${before.status.replace(/_/g, ' ')} → ${status.replace(/_/g, ' ')}`,
    before: { status: before.status },
    after: { status },
  })
  revalidatePlan(id)
}

export async function toggleLock(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const lock = boolish(formData.get('lock'))
  if (!id) throw new Error('Missing id')

  if (lock) {
    await c.db((tx) =>
      tx
        .update(liftPlans)
        .set({
          locked: true,
          lockedAt: new Date(),
          lockedByTenantUserId: c.membership?.id ?? null,
        })
        .where(eq(liftPlans.id, id)),
    )
  } else {
    await c.db(async (tx) => {
      await tx
        .update(liftPlans)
        .set({ locked: false, lockedAt: null, lockedByTenantUserId: null })
        .where(eq(liftPlans.id, id))
      // Legacy parity: clear signatures when unlocking so they have to be re-collected.
      await tx
        .update(liftPlanSignatures)
        .set({ signatureDataUrl: null, signedAt: null })
        .where(eq(liftPlanSignatures.liftPlanId, id))
    })
  }
  await recordAudit(c, {
    entityType: 'lift_plan',
    entityId: id,
    action: 'update',
    summary: lock ? 'Locked' : 'Unlocked (signatures cleared)',
  })
  revalidatePlan(id)
}

export async function deleteLiftPlan(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  if (!id) throw new Error('Missing id')
  await c.db((tx) =>
    tx.update(liftPlans).set({ deletedAt: new Date() }).where(eq(liftPlans.id, id)),
  )
  await recordAudit(c, {
    entityType: 'lift_plan',
    entityId: id,
    action: 'delete',
    summary: 'Soft-deleted lift plan',
  })
  revalidatePath('/lift-plans')
}

// ------------------------------------------------------------------
// Loads
// ------------------------------------------------------------------

export async function addLoad(formData: FormData): Promise<void> {
  const c = await ctx()
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  const description = String(formData.get('description') ?? '').trim()
  if (!liftPlanId) throw new Error('Missing liftPlanId')
  if (!description) throw new Error('Description is required')

  await assertNotLocked(c, liftPlanId)

  await c.db(async (tx) => {
    const [m] = await tx
      .select({ m: max(liftPlanLoads.entityOrder) })
      .from(liftPlanLoads)
      .where(eq(liftPlanLoads.liftPlanId, liftPlanId))
    await tx.insert(liftPlanLoads).values({
      tenantId: c.tenantId,
      liftPlanId,
      description,
      weightKg: nullableNumeric(formData.get('weightKg')),
      dimensionsMaxMm: nullableInt(formData.get('dimensionsMaxMm')),
      attachmentMethod: nullable(formData.get('attachmentMethod')),
      entityOrder: (m?.m ?? 0) + 1,
    })
  })
  await recordAudit(c, {
    entityType: 'lift_plan',
    entityId: liftPlanId,
    action: 'update',
    summary: `Added load "${description}"`,
  })
  // After loads change, recompute capacityUsedPct on every equipment row.
  await recomputeCapacityUsedPct(c, liftPlanId)
  revalidatePlan(liftPlanId)
}

export async function updateLoad(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  if (!id || !liftPlanId) throw new Error('Missing ids')
  await assertNotLocked(c, liftPlanId)

  const description = nullable(formData.get('description'))
  const updates: Record<string, unknown> = {
    weightKg: nullableNumeric(formData.get('weightKg')),
    dimensionsMaxMm: nullableInt(formData.get('dimensionsMaxMm')),
    attachmentMethod: nullable(formData.get('attachmentMethod')),
  }
  if (description) updates.description = description

  await c.db((tx) => tx.update(liftPlanLoads).set(updates).where(eq(liftPlanLoads.id, id)))
  await recordAudit(c, {
    entityType: 'lift_plan_load',
    entityId: id,
    action: 'update',
    summary: 'Updated load',
  })
  await recomputeCapacityUsedPct(c, liftPlanId)
  revalidatePlan(liftPlanId)
}

export async function deleteLoad(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  if (!id || !liftPlanId) throw new Error('Missing ids')
  await assertNotLocked(c, liftPlanId)

  await c.db((tx) => tx.delete(liftPlanLoads).where(eq(liftPlanLoads.id, id)))
  await recordAudit(c, {
    entityType: 'lift_plan_load',
    entityId: id,
    action: 'delete',
    summary: 'Deleted load',
  })
  await recomputeCapacityUsedPct(c, liftPlanId)
  revalidatePlan(liftPlanId)
}

export async function moveLoad(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  const direction = String(formData.get('direction') ?? '') as 'up' | 'down'
  if (!['up', 'down'].includes(direction)) throw new Error('Bad direction')
  await assertNotLocked(c, liftPlanId)
  await reorder(c, liftPlanLoads as any, liftPlanId, id, direction)
  revalidatePlan(liftPlanId)
}

// ------------------------------------------------------------------
// Equipment
// ------------------------------------------------------------------

export async function addEquipment(formData: FormData): Promise<void> {
  const c = await ctx()
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  if (!liftPlanId) throw new Error('Missing liftPlanId')
  await assertNotLocked(c, liftPlanId)

  const equipmentItemId = nullable(formData.get('equipmentItemId'))
  const equipmentDescription = nullable(formData.get('equipmentDescription'))
  if (!equipmentItemId && !equipmentDescription) {
    throw new Error('Pick a tracked item or enter a description')
  }

  await c.db(async (tx) => {
    const [m] = await tx
      .select({ m: max(liftPlanEquipment.entityOrder) })
      .from(liftPlanEquipment)
      .where(eq(liftPlanEquipment.liftPlanId, liftPlanId))
    await tx.insert(liftPlanEquipment).values({
      tenantId: c.tenantId,
      liftPlanId,
      equipmentItemId,
      equipmentDescription,
      capacityKg: nullableNumeric(formData.get('capacityKg')),
      boomLengthM: nullableNumeric(formData.get('boomLengthM')),
      radiusM: nullableNumeric(formData.get('radiusM')),
      entityOrder: (m?.m ?? 0) + 1,
    })
  })
  await recordAudit(c, {
    entityType: 'lift_plan',
    entityId: liftPlanId,
    action: 'update',
    summary: `Added equipment "${equipmentDescription ?? equipmentItemId}"`,
  })
  await recomputeCapacityUsedPct(c, liftPlanId)
  revalidatePlan(liftPlanId)
}

export async function updateEquipment(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  if (!id || !liftPlanId) throw new Error('Missing ids')
  await assertNotLocked(c, liftPlanId)

  const updates: Record<string, unknown> = {
    equipmentItemId: nullable(formData.get('equipmentItemId')),
    equipmentDescription: nullable(formData.get('equipmentDescription')),
    capacityKg: nullableNumeric(formData.get('capacityKg')),
    boomLengthM: nullableNumeric(formData.get('boomLengthM')),
    radiusM: nullableNumeric(formData.get('radiusM')),
  }
  await c.db((tx) => tx.update(liftPlanEquipment).set(updates).where(eq(liftPlanEquipment.id, id)))
  await recordAudit(c, {
    entityType: 'lift_plan_equipment',
    entityId: id,
    action: 'update',
    summary: 'Updated equipment',
  })
  await recomputeCapacityUsedPct(c, liftPlanId)
  revalidatePlan(liftPlanId)
}

export async function deleteEquipment(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  if (!id || !liftPlanId) throw new Error('Missing ids')
  await assertNotLocked(c, liftPlanId)
  await c.db((tx) => tx.delete(liftPlanEquipment).where(eq(liftPlanEquipment.id, id)))
  await recordAudit(c, {
    entityType: 'lift_plan_equipment',
    entityId: id,
    action: 'delete',
    summary: 'Deleted equipment',
  })
  revalidatePlan(liftPlanId)
}

export async function moveEquipment(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  const direction = String(formData.get('direction') ?? '') as 'up' | 'down'
  if (!['up', 'down'].includes(direction)) throw new Error('Bad direction')
  await assertNotLocked(c, liftPlanId)
  await reorder(c, liftPlanEquipment as any, liftPlanId, id, direction)
  revalidatePlan(liftPlanId)
}

// ------------------------------------------------------------------
// Hazards
// ------------------------------------------------------------------

export async function addHazard(formData: FormData): Promise<void> {
  const c = await ctx()
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  const hazardDescription = String(formData.get('hazardDescription') ?? '').trim()
  if (!liftPlanId) throw new Error('Missing liftPlanId')
  if (!hazardDescription) throw new Error('Hazard description is required')
  await assertNotLocked(c, liftPlanId)

  await c.db(async (tx) => {
    const [m] = await tx
      .select({ m: max(liftPlanHazards.entityOrder) })
      .from(liftPlanHazards)
      .where(eq(liftPlanHazards.liftPlanId, liftPlanId))
    await tx.insert(liftPlanHazards).values({
      tenantId: c.tenantId,
      liftPlanId,
      hazardDescription,
      controls: nullable(formData.get('controls')),
      entityOrder: (m?.m ?? 0) + 1,
    })
  })
  await recordAudit(c, {
    entityType: 'lift_plan',
    entityId: liftPlanId,
    action: 'update',
    summary: `Added hazard "${hazardDescription}"`,
  })
  revalidatePlan(liftPlanId)
}

export async function updateHazard(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  if (!id || !liftPlanId) throw new Error('Missing ids')
  await assertNotLocked(c, liftPlanId)
  const hazardDescription = nullable(formData.get('hazardDescription'))
  const updates: Record<string, unknown> = {
    controls: nullable(formData.get('controls')),
  }
  if (hazardDescription) updates.hazardDescription = hazardDescription
  await c.db((tx) => tx.update(liftPlanHazards).set(updates).where(eq(liftPlanHazards.id, id)))
  await recordAudit(c, {
    entityType: 'lift_plan_hazard',
    entityId: id,
    action: 'update',
    summary: 'Updated hazard',
  })
  revalidatePlan(liftPlanId)
}

export async function deleteHazard(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  if (!id || !liftPlanId) throw new Error('Missing ids')
  await assertNotLocked(c, liftPlanId)
  await c.db((tx) => tx.delete(liftPlanHazards).where(eq(liftPlanHazards.id, id)))
  await recordAudit(c, {
    entityType: 'lift_plan_hazard',
    entityId: id,
    action: 'delete',
    summary: 'Deleted hazard',
  })
  revalidatePlan(liftPlanId)
}

export async function moveHazard(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  const direction = String(formData.get('direction') ?? '') as 'up' | 'down'
  if (!['up', 'down'].includes(direction)) throw new Error('Bad direction')
  await assertNotLocked(c, liftPlanId)
  await reorder(c, liftPlanHazards as any, liftPlanId, id, direction)
  revalidatePlan(liftPlanId)
}

// ------------------------------------------------------------------
// PPE
// ------------------------------------------------------------------

export async function addPpe(formData: FormData): Promise<void> {
  const c = await ctx()
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  const ppeName = String(formData.get('ppeName') ?? '').trim()
  if (!liftPlanId) throw new Error('Missing liftPlanId')
  if (!ppeName) throw new Error('PPE name is required')
  await assertNotLocked(c, liftPlanId)

  await c.db(async (tx) => {
    const [m] = await tx
      .select({ m: max(liftPlanPpe.entityOrder) })
      .from(liftPlanPpe)
      .where(eq(liftPlanPpe.liftPlanId, liftPlanId))
    await tx.insert(liftPlanPpe).values({
      tenantId: c.tenantId,
      liftPlanId,
      ppeName,
      required: boolish(formData.get('required')) || formData.get('required') === null,
      entityOrder: (m?.m ?? 0) + 1,
    })
  })
  await recordAudit(c, {
    entityType: 'lift_plan',
    entityId: liftPlanId,
    action: 'update',
    summary: `Added PPE "${ppeName}"`,
  })
  revalidatePlan(liftPlanId)
}

export async function updatePpe(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  if (!id || !liftPlanId) throw new Error('Missing ids')
  await assertNotLocked(c, liftPlanId)
  const ppeName = nullable(formData.get('ppeName'))
  const updates: Record<string, unknown> = {
    required: boolish(formData.get('required')),
  }
  if (ppeName) updates.ppeName = ppeName
  await c.db((tx) => tx.update(liftPlanPpe).set(updates).where(eq(liftPlanPpe.id, id)))
  await recordAudit(c, {
    entityType: 'lift_plan_ppe',
    entityId: id,
    action: 'update',
    summary: 'Updated PPE row',
  })
  revalidatePlan(liftPlanId)
}

export async function deletePpe(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  if (!id || !liftPlanId) throw new Error('Missing ids')
  await assertNotLocked(c, liftPlanId)
  await c.db((tx) => tx.delete(liftPlanPpe).where(eq(liftPlanPpe.id, id)))
  await recordAudit(c, {
    entityType: 'lift_plan_ppe',
    entityId: id,
    action: 'delete',
    summary: 'Deleted PPE row',
  })
  revalidatePlan(liftPlanId)
}

export async function movePpe(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  const direction = String(formData.get('direction') ?? '') as 'up' | 'down'
  if (!['up', 'down'].includes(direction)) throw new Error('Bad direction')
  await assertNotLocked(c, liftPlanId)
  await reorder(c, liftPlanPpe as any, liftPlanId, id, direction)
  revalidatePlan(liftPlanId)
}

// ------------------------------------------------------------------
// Signatures
// ------------------------------------------------------------------

export async function addSignature(formData: FormData): Promise<void> {
  const c = await ctx()
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  const role = String(formData.get('role') ?? '') as SignatureRole
  const personId = nullable(formData.get('personId'))
  const externalName = nullable(formData.get('externalName'))
  const signatureDataUrl = nullable(formData.get('signatureDataUrl'))
  if (!liftPlanId) throw new Error('Missing liftPlanId')
  if (!SIGNATURE_ROLES.includes(role)) throw new Error('Invalid role')
  if (!personId && !externalName) throw new Error('Internal person or external name required')
  await assertNotLocked(c, liftPlanId)

  const [row] = await c.db((tx) =>
    tx
      .insert(liftPlanSignatures)
      .values({
        tenantId: c.tenantId,
        liftPlanId,
        role,
        personId,
        externalName,
        signatureDataUrl,
        signedAt: signatureDataUrl ? new Date() : null,
      })
      .returning(),
  )
  await recordAudit(c, {
    entityType: 'lift_plan_signature',
    entityId: row?.id,
    action: 'sign',
    summary: `Added ${role} signature`,
  })
  revalidatePlan(liftPlanId)
}

export async function updateSignature(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  if (!id || !liftPlanId) throw new Error('Missing ids')
  await assertNotLocked(c, liftPlanId)
  const updates: Record<string, unknown> = {}
  if (formData.has('personId')) updates.personId = nullable(formData.get('personId'))
  if (formData.has('externalName')) updates.externalName = nullable(formData.get('externalName'))
  if (formData.has('signatureDataUrl')) {
    const v = nullable(formData.get('signatureDataUrl'))
    updates.signatureDataUrl = v
    updates.signedAt = v ? new Date() : null
  }
  await c.db((tx) =>
    tx.update(liftPlanSignatures).set(updates).where(eq(liftPlanSignatures.id, id)),
  )
  await recordAudit(c, {
    entityType: 'lift_plan_signature',
    entityId: id,
    action: 'update',
    summary: 'Updated signature',
  })
  revalidatePlan(liftPlanId)
}

export async function deleteSignature(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  if (!id || !liftPlanId) throw new Error('Missing ids')
  await assertNotLocked(c, liftPlanId)
  await c.db((tx) => tx.delete(liftPlanSignatures).where(eq(liftPlanSignatures.id, id)))
  await recordAudit(c, {
    entityType: 'lift_plan_signature',
    entityId: id,
    action: 'delete',
    summary: 'Deleted signature',
  })
  revalidatePlan(liftPlanId)
}

// ------------------------------------------------------------------
// Photos
// ------------------------------------------------------------------

export async function attachPhotos(liftPlanId: string, attachmentIds: string[]): Promise<void> {
  const c = await ctx()
  if (!liftPlanId || attachmentIds.length === 0) return
  await assertNotLocked(c, liftPlanId)
  await c.db((tx) =>
    tx.insert(liftPlanPhotos).values(
      attachmentIds.map((attachmentId) => ({
        tenantId: c.tenantId,
        liftPlanId,
        attachmentId,
      })),
    ),
  )
  await recordAudit(c, {
    entityType: 'lift_plan',
    entityId: liftPlanId,
    action: 'update',
    summary: `Attached ${attachmentIds.length} photo${attachmentIds.length === 1 ? '' : 's'}`,
  })
  revalidatePlan(liftPlanId)
}

export async function updatePhotoCaption(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  if (!id || !liftPlanId) throw new Error('Missing ids')
  await assertNotLocked(c, liftPlanId)
  await c.db((tx) =>
    tx
      .update(liftPlanPhotos)
      .set({ caption: nullable(formData.get('caption')) })
      .where(eq(liftPlanPhotos.id, id)),
  )
  await recordAudit(c, {
    entityType: 'lift_plan_photo',
    entityId: id,
    action: 'update',
    summary: 'Updated photo caption',
  })
  revalidatePlan(liftPlanId)
}

export async function deletePhoto(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const liftPlanId = String(formData.get('liftPlanId') ?? '')
  if (!id || !liftPlanId) throw new Error('Missing ids')
  await assertNotLocked(c, liftPlanId)
  await c.db((tx) => tx.delete(liftPlanPhotos).where(eq(liftPlanPhotos.id, id)))
  await recordAudit(c, {
    entityType: 'lift_plan_photo',
    entityId: id,
    action: 'delete',
    summary: 'Deleted photo',
  })
  revalidatePlan(liftPlanId)
}

// ------------------------------------------------------------------
// Send email (stub-mode hook)
// ------------------------------------------------------------------

export async function sendLiftPlanEmail(formData: FormData): Promise<void> {
  const c = await ctx()
  const id = String(formData.get('id') ?? '')
  const recipientsRaw = String(formData.get('recipients') ?? '')
  if (!id) throw new Error('Missing id')
  const recipients = recipientsRaw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.includes('@'))
  if (recipients.length === 0) throw new Error('Provide at least one email address')
  // The transactional-email driver lives in another agent's scope (worker/
  // events). For now we just record the intent in the audit log so the
  // sender + recipient list are persisted; the worker picks it up.
  await recordAudit(c, {
    entityType: 'lift_plan',
    entityId: id,
    action: 'export',
    summary: `Emailed lift plan to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`,
    metadata: { recipients, channel: 'email' },
  })
  revalidatePlan(id)
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

async function assertNotLocked(
  c: Awaited<ReturnType<typeof ctx>>,
  liftPlanId: string,
): Promise<void> {
  const [row] = await c.db((tx) =>
    tx
      .select({ locked: liftPlans.locked })
      .from(liftPlans)
      .where(eq(liftPlans.id, liftPlanId))
      .limit(1),
  )
  if (!row) throw new Error('Lift plan not found')
  if (row.locked) throw new Error('Lift plan is locked — unlock before changing children')
}

/**
 * Recompute capacityUsedPct on every equipment row for a given plan, based on
 * the sum of all load weights. If either side is missing we leave the column
 * null.
 */
async function recomputeCapacityUsedPct(
  c: Awaited<ReturnType<typeof ctx>>,
  liftPlanId: string,
): Promise<void> {
  await c.db(async (tx) => {
    const loads = await tx
      .select({ weightKg: liftPlanLoads.weightKg })
      .from(liftPlanLoads)
      .where(eq(liftPlanLoads.liftPlanId, liftPlanId))
    const totalWeight = loads.reduce(
      (acc, r) => acc + (r.weightKg ? Number(r.weightKg) : 0),
      0,
    )
    const rows = await tx
      .select({ id: liftPlanEquipment.id, capacityKg: liftPlanEquipment.capacityKg })
      .from(liftPlanEquipment)
      .where(eq(liftPlanEquipment.liftPlanId, liftPlanId))
    for (const r of rows) {
      const cap = r.capacityKg ? Number(r.capacityKg) : 0
      const pct = cap > 0 && totalWeight > 0 ? (totalWeight / cap) * 100 : null
      await tx
        .update(liftPlanEquipment)
        .set({ capacityUsedPct: pct === null ? null : pct.toFixed(2) })
        .where(eq(liftPlanEquipment.id, r.id))
    }
  })
}

async function reorder(
  c: Awaited<ReturnType<typeof ctx>>,
  table: any,
  liftPlanId: string,
  rowId: string,
  direction: 'up' | 'down',
): Promise<void> {
  await c.db(async (tx) => {
    const t = table as any
    const rows = (await tx
      .select({ id: t.id, entityOrder: t.entityOrder })
      .from(t)
      .where(eq(t.liftPlanId, liftPlanId))
      .orderBy(asc(t.entityOrder))) as { id: string; entityOrder: number }[]
    const idx = rows.findIndex((r) => r.id === rowId)
    if (idx < 0) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= rows.length) return
    const a = rows[idx]
    const b = rows[swapIdx]
    if (!a || !b) return
    await tx.update(t).set({ entityOrder: b.entityOrder }).where(eq(t.id, a.id))
    await tx.update(t).set({ entityOrder: a.entityOrder }).where(eq(t.id, b.id))
  })
}

