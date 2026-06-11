'use server'

// Server actions for the Safe Distance tool.
//
// All mutations record an audit-log entry so the activity tab of the detail
// page tells a coherent story. Locking semantics mirror corrective-actions:
//   - records can be edited freely while `locked = false`
//   - lockRecord() flips it to true and any subsequent edit/delete short-
//     circuits with an error
//   - unlocking is a separate action so the operator has to consciously
//     re-open a sealed assessment

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, count, eq, sql } from 'drizzle-orm'
import { safeDistanceRecords } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { computeRequiredDistanceM, type SafeDistanceType } from './_lib'

export type ActionResult = { ok: true } | { ok: false; error: string }

const TYPES = ['electrical', 'drone', 'overhead_crane', 'vehicle', 'other'] as const

async function loadRecord(ctx: Awaited<ReturnType<typeof requireRequestContext>>, id: string) {
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(safeDistanceRecords)
      .where(eq(safeDistanceRecords.id, id))
      .limit(1)
    return row ?? null
  })
}

function assertNotLocked(rec: { locked: boolean }): ActionResult | null {
  if (rec.locked) return { ok: false, error: 'This record is locked.' }
  return null
}

function safeTenantUserId(ctx: Awaited<ReturnType<typeof requireRequestContext>>): string | null {
  const id = ctx.membership?.id
  if (!id || id === 'super-admin') return null
  return id
}

function parseNumber(raw: FormDataEntryValue | null): number | null {
  if (raw === null) return null
  const s = String(raw).trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Generate the next SD-YYYY-NNNN reference within the tenant for the current
 * calendar year. Uses the existing `safe_distance_records` count for the year
 * + 1 — the unique index on (tenantId, reference) protects against the
 * extremely unlikely race where two creators land at exactly the same number.
 */
async function nextReference(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
): Promise<string> {
  const year = new Date().getFullYear()
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select({ c: count() })
      .from(safeDistanceRecords)
      .where(
        sql`extract(year from ${safeDistanceRecords.occurredAt}) = ${year} AND ${safeDistanceRecords.tenantId} = ${ctx.tenantId} AND ${safeDistanceRecords.reference} LIKE 'SD-%'`,
      )
    const n = Number(row?.c ?? 0) + 1
    return `SD-${year}-${String(n).padStart(4, '0')}`
  })
}

// ---------- Create ------------------------------------------------------

/**
 * Create a new safe-distance record. The required distance is recomputed
 * server-side from `type` + `voltageKv` so the client cannot fabricate a
 * lower threshold; the operator may override `requiredDistanceMOverride` only
 * for the 'other' type (where there is no canonical lookup).
 */
export async function createSafeDistanceRecord(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  const type = String(formData.get('type') ?? '') as SafeDistanceType
  if (!TYPES.includes(type)) throw new Error('Invalid type')

  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const sourceDescription = String(formData.get('sourceDescription') ?? '').trim() || null
  const supervisorTenantUserId = String(formData.get('supervisorTenantUserId') ?? '').trim() || null
  const operatorPersonId = String(formData.get('operatorPersonId') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  const voltageKv = parseNumber(formData.get('sourceVoltageKv'))
  const heightM = parseNumber(formData.get('heightM'))
  const actualDistanceM = parseNumber(formData.get('actualDistanceM'))
  if (actualDistanceM === null || actualDistanceM < 0) {
    throw new Error('Actual distance is required')
  }

  // Required distance: always server-computed for known types. For 'other',
  // the form supplies a manual value (the only place we trust the client).
  let requiredDistanceM = computeRequiredDistanceM({ type, voltageKv, heightM })
  if (type === 'other') {
    const manual = parseNumber(formData.get('requiredDistanceMOverride'))
    if (manual !== null && manual >= 0) requiredDistanceM = manual
  }

  const complies = actualDistanceM >= requiredDistanceM

  const reference = await nextReference(ctx)

  const inserted = await ctx.db((tx) =>
    tx
      .insert(safeDistanceRecords)
      .values({
        tenantId: ctx.tenantId!,
        reference,
        type,
        siteOrgUnitId,
        sourceVoltageKv: voltageKv !== null ? String(voltageKv) : null,
        heightM: heightM !== null ? String(heightM) : null,
        sourceDescription,
        requiredDistanceM: String(requiredDistanceM),
        actualDistanceM: String(actualDistanceM),
        complies,
        supervisorTenantUserId,
        operatorPersonId,
        occurredAt: new Date(),
        notes,
      })
      .returning(),
  )
  const row = inserted[0]
  if (!row) throw new Error('Insert failed')

  await recordAudit(ctx, {
    entityType: 'safe_distance_record',
    entityId: row.id,
    action: 'create',
    summary: `Created ${row.reference} (${type})`,
    after: {
      type,
      requiredDistanceM,
      actualDistanceM,
      complies,
    },
  })
  revalidatePath('/tools/safe-distance')
  redirect(`/tools/safe-distance/${row.id}`)
}

// ---------- Update ------------------------------------------------------

/**
 * Update measurement fields on an unlocked record. Re-computes
 * `requiredDistanceM` + `complies` server-side from the new inputs so the two
 * can never drift.
 */
export async function updateSafeDistanceRecord(formData: FormData): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return { ok: false, error: 'Missing id' }
  const rec = await loadRecord(ctx, id)
  if (!rec) return { ok: false, error: 'Record not found' }
  const lockErr = assertNotLocked(rec)
  if (lockErr) return lockErr

  const sourceDescription = String(formData.get('sourceDescription') ?? '').trim() || null
  const supervisorTenantUserId = String(formData.get('supervisorTenantUserId') ?? '').trim() || null
  const operatorPersonId = String(formData.get('operatorPersonId') ?? '').trim() || null
  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  const voltageKv = parseNumber(formData.get('sourceVoltageKv'))
  const heightM = parseNumber(formData.get('heightM'))
  const actualDistanceM = parseNumber(formData.get('actualDistanceM'))
  if (actualDistanceM === null || actualDistanceM < 0) {
    return { ok: false, error: 'Actual distance is required' }
  }

  let requiredDistanceM = computeRequiredDistanceM({
    type: rec.type as SafeDistanceType,
    voltageKv,
    heightM,
  })
  if (rec.type === 'other') {
    const manual = parseNumber(formData.get('requiredDistanceMOverride'))
    if (manual !== null && manual >= 0) requiredDistanceM = manual
  }
  const complies = actualDistanceM >= requiredDistanceM

  await ctx.db((tx) =>
    tx
      .update(safeDistanceRecords)
      .set({
        sourceVoltageKv: voltageKv !== null ? String(voltageKv) : null,
        heightM: heightM !== null ? String(heightM) : null,
        sourceDescription,
        requiredDistanceM: String(requiredDistanceM),
        actualDistanceM: String(actualDistanceM),
        complies,
        supervisorTenantUserId,
        operatorPersonId,
        siteOrgUnitId,
        notes,
      })
      .where(eq(safeDistanceRecords.id, id)),
  )

  await recordAudit(ctx, {
    entityType: 'safe_distance_record',
    entityId: id,
    action: 'update',
    summary: 'Edited measurement',
    before: {
      requiredDistanceM: rec.requiredDistanceM,
      actualDistanceM: rec.actualDistanceM,
      complies: rec.complies,
    },
    after: {
      requiredDistanceM,
      actualDistanceM,
      complies,
    },
  })
  revalidatePath(`/tools/safe-distance/${id}`)
  revalidatePath('/tools/safe-distance')
  return { ok: true }
}

// ---------- Lock / unlock / delete --------------------------------------

export async function lockSafeDistanceRecord(id: string): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  const rec = await loadRecord(ctx, id)
  if (!rec) return { ok: false, error: 'Record not found' }
  if (rec.locked) return { ok: true }

  await ctx.db((tx) =>
    tx.update(safeDistanceRecords).set({ locked: true }).where(eq(safeDistanceRecords.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'safe_distance_record',
    entityId: id,
    action: 'update',
    summary: 'Locked record',
    after: { locked: true, lockedBy: safeTenantUserId(ctx) },
  })
  revalidatePath(`/tools/safe-distance/${id}`)
  revalidatePath('/tools/safe-distance')
  return { ok: true }
}

export async function unlockSafeDistanceRecord(id: string): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  const rec = await loadRecord(ctx, id)
  if (!rec) return { ok: false, error: 'Record not found' }
  if (!rec.locked) return { ok: true }

  await ctx.db((tx) =>
    tx.update(safeDistanceRecords).set({ locked: false }).where(eq(safeDistanceRecords.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'safe_distance_record',
    entityId: id,
    action: 'update',
    summary: 'Unlocked record',
    after: { locked: false, unlockedBy: safeTenantUserId(ctx) },
  })
  revalidatePath(`/tools/safe-distance/${id}`)
  return { ok: true }
}

export async function deleteSafeDistanceRecord(id: string): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  const rec = await loadRecord(ctx, id)
  if (!rec) return { ok: false, error: 'Record not found' }
  const lockErr = assertNotLocked(rec)
  if (lockErr) return lockErr

  await ctx.db((tx) =>
    tx
      .update(safeDistanceRecords)
      .set({ deletedAt: new Date() })
      .where(eq(safeDistanceRecords.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'safe_distance_record',
    entityId: id,
    action: 'delete',
    summary: `Deleted ${rec.reference}`,
  })
  revalidatePath('/tools/safe-distance')
  return { ok: true }
}

/**
 * Form-action wrapper around delete + redirect, used by the detail page's
 * Delete button which needs a void-returning server action.
 */
export async function deleteSafeDistanceRecordAndRedirect(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await deleteSafeDistanceRecord(id)
  redirect('/tools/safe-distance')
}

/**
 * Form-action wrapper around lock/unlock for use inside <form action={…}>.
 */
export async function toggleLockSafeDistanceRecord(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const desired = String(formData.get('desired') ?? '') === 'true'
  if (!id) return
  if (desired) await lockSafeDistanceRecord(id)
  else await unlockSafeDistanceRecord(id)
}

// Helper so the new-record form's submit can be a void-returning action.
export async function createSafeDistanceRecordForm(formData: FormData): Promise<void> {
  await createSafeDistanceRecord(formData)
}

// Helper so the edit form's submit can return void.
export async function updateSafeDistanceRecordForm(formData: FormData): Promise<void> {
  await updateSafeDistanceRecord(formData)
  const id = String(formData.get('id') ?? '')
  if (id) redirect(`/tools/safe-distance/${id}`)
}
