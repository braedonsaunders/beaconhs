'use server'

// Server actions for the Safe Distance pressure-test tool.
//
// The save action is AUTHORITATIVE: it recomputes total volume + all three
// method distances server-side from the submitted inputs, so the client's live
// preview can never persist a fabricated result. Pipe segments are replaced
// wholesale on each save (delete-all + re-insert) inside the tenant tx.
//
// Locking semantics mirror corrective-actions: records edit freely while
// `locked = false`; locking seals the assessment and any edit/delete short-
// circuits with an error until it is explicitly unlocked.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { count, eq, sql } from 'drizzle-orm'
import { safeDistanceRecords, safeDistanceSegments } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import {
  computeSafeDistance,
  segmentVolumeM3,
  type SafeDistanceMethod,
  type SafeDistanceSegmentUnit,
  type SafeDistanceUnit,
} from './_lib'

export type ActionResult = { ok: true } | { ok: false; error: string }

const METHODS: SafeDistanceMethod[] = ['nasa', 'asme', 'lloyds']
const UNITS: SafeDistanceUnit[] = ['metric', 'imperial']
const SEGMENT_UNITS: SafeDistanceSegmentUnit[] = ['inch', 'feet', 'mm', 'cm', 'm']

export type SegmentInput = {
  name?: string | null
  unit: SafeDistanceSegmentUnit
  lengthValue: number
  internalDiameter: number
}

export type SaveSafeDistanceInput = {
  id: string
  name: string
  method: SafeDistanceMethod
  unit: SafeDistanceUnit
  testPressure: number
  description?: string | null
  siteOrgUnitId?: string | null
  supervisorTenantUserId?: string | null
  operatorPersonId?: string | null
  notes?: string | null
  segments: SegmentInput[]
}

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

function num(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : 0
}

/**
 * Generate the next SD-YYYY-NNNN reference within the tenant for the current
 * calendar year. The unique index on (tenantId, reference) protects against the
 * unlikely race where two creators land on the same number.
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
 * Create a new pressure-test assessment from the /new form, then redirect to
 * the calculator editor where the operator adds pipe segments.
 */
export async function createSafeDistanceRecord(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()

  const name = String(formData.get('name') ?? '').trim() || 'New pressure test'
  const methodRaw = String(formData.get('method') ?? 'nasa') as SafeDistanceMethod
  const method = METHODS.includes(methodRaw) ? methodRaw : 'nasa'
  const unitRaw = String(formData.get('unit') ?? 'imperial') as SafeDistanceUnit
  const unit = UNITS.includes(unitRaw) ? unitRaw : 'imperial'
  const testPressure = num(formData.get('testPressure'))
  const description = String(formData.get('description') ?? '').trim() || null
  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const supervisorTenantUserId = String(formData.get('supervisorTenantUserId') ?? '').trim() || null
  const operatorPersonId = String(formData.get('operatorPersonId') ?? '').trim() || null

  const reference = await nextReference(ctx)

  const inserted = await ctx.db((tx) =>
    tx
      .insert(safeDistanceRecords)
      .values({
        tenantId: ctx.tenantId!,
        reference,
        name,
        method,
        unit,
        testPressure: String(testPressure),
        description,
        siteOrgUnitId,
        supervisorTenantUserId,
        operatorPersonId,
        occurredAt: new Date(),
      })
      .returning(),
  )
  const row = inserted[0]
  if (!row) throw new Error('Insert failed')

  await recordAudit(ctx, {
    entityType: 'safe_distance_record',
    entityId: row.id,
    action: 'create',
    summary: `Created ${row.reference} (${name})`,
    after: { name, method, unit },
  })
  revalidatePath('/tools/safe-distance')
  redirect(`/tools/safe-distance/${row.id}`)
}

// ---------- Save (authoritative recompute) ------------------------------

/**
 * Persist the calculator: update parent fields, recompute total volume + all
 * three method distances server-side, and replace the pipe segments. Returns
 * the freshly computed results so the editor can reflect the canonical values.
 */
export async function saveSafeDistanceRecord(
  input: SaveSafeDistanceInput,
): Promise<ActionResult & { results?: ReturnType<typeof computeSafeDistance> }> {
  const ctx = await requireRequestContext()
  const id = input.id
  if (!id) return { ok: false, error: 'Missing id' }
  const rec = await loadRecord(ctx, id)
  if (!rec) return { ok: false, error: 'Record not found' }
  const lockErr = assertNotLocked(rec)
  if (lockErr) return lockErr

  const method = METHODS.includes(input.method) ? input.method : 'nasa'
  const unit = UNITS.includes(input.unit) ? input.unit : 'imperial'
  const segments = (input.segments ?? []).map((s) => ({
    name: (s.name ?? '').trim() || null,
    unit: SEGMENT_UNITS.includes(s.unit) ? s.unit : ('inch' as SafeDistanceSegmentUnit),
    lengthValue: num(s.lengthValue),
    internalDiameter: num(s.internalDiameter),
  }))

  const results = computeSafeDistance({
    method,
    unit,
    testPressure: num(input.testPressure),
    segments,
  })

  await ctx.db(async (tx) => {
    await tx
      .update(safeDistanceRecords)
      .set({
        name: input.name.trim() || 'Pressure test',
        method,
        unit,
        testPressure: String(num(input.testPressure)),
        description: (input.description ?? '').trim() || null,
        siteOrgUnitId: (input.siteOrgUnitId ?? '').trim() || null,
        supervisorTenantUserId: (input.supervisorTenantUserId ?? '').trim() || null,
        operatorPersonId: (input.operatorPersonId ?? '').trim() || null,
        notes: (input.notes ?? '').trim() || null,
        totalVolume: String(results.totalVolume),
        resultNasa: String(results.nasa),
        resultAsme: String(results.asme),
        resultLloyds: String(results.lloyds),
      })
      .where(eq(safeDistanceRecords.id, id))

    // Replace segments wholesale — simpler + atomic vs. per-row diffing.
    await tx.delete(safeDistanceSegments).where(eq(safeDistanceSegments.recordId, id))
    if (segments.length > 0) {
      await tx.insert(safeDistanceSegments).values(
        segments.map((s, i) => ({
          tenantId: ctx.tenantId!,
          recordId: id,
          name: s.name,
          unit: s.unit,
          lengthValue: String(s.lengthValue),
          internalDiameter: String(s.internalDiameter),
          volumeM3: String(segmentVolumeM3(s.lengthValue, s.internalDiameter, s.unit)),
          sortOrder: i,
        })),
      )
    }
  })

  await recordAudit(ctx, {
    entityType: 'safe_distance_record',
    entityId: id,
    action: 'update',
    summary: `Updated calculation (${segments.length} segment${segments.length === 1 ? '' : 's'})`,
    after: {
      method,
      unit,
      totalVolume: results.totalVolume,
      chosen: results.chosen,
    },
  })
  revalidatePath(`/tools/safe-distance/${id}`)
  revalidatePath('/tools/safe-distance')
  return { ok: true, results }
}

// ---------- Lock / unlock / delete ------------------------------------

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

/** Form-action wrapper around delete + redirect for the detail page button. */
export async function deleteSafeDistanceRecordAndRedirect(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await deleteSafeDistanceRecord(id)
  redirect('/tools/safe-distance')
}

/** Form-action wrapper around lock/unlock for use inside <form action={…}>. */
export async function toggleLockSafeDistanceRecord(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const desired = String(formData.get('desired') ?? '') === 'true'
  if (!id) return
  if (desired) await lockSafeDistanceRecord(id)
  else await unlockSafeDistanceRecord(id)
}

/**
 * Form-action wrapper around `saveSafeDistanceRecord` so the calculator editor
 * can submit via a plain <form>. Segments arrive as a JSON string in the
 * `segments` field. Stays on the page (no redirect) — revalidation refreshes
 * the server-computed results.
 */
export async function saveSafeDistanceRecordForm(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  if (!id) return
  let segments: SegmentInput[] = []
  try {
    const raw = String(formData.get('segments') ?? '[]')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      segments = parsed.map((s: Record<string, unknown>) => ({
        name: typeof s.name === 'string' ? s.name : null,
        unit: s.unit as SafeDistanceSegmentUnit,
        lengthValue: num(s.lengthValue),
        internalDiameter: num(s.internalDiameter),
      }))
    }
  } catch {
    segments = []
  }
  await saveSafeDistanceRecord({
    id,
    name: String(formData.get('name') ?? ''),
    method: String(formData.get('method') ?? 'nasa') as SafeDistanceMethod,
    unit: String(formData.get('unit') ?? 'imperial') as SafeDistanceUnit,
    testPressure: num(formData.get('testPressure')),
    description: String(formData.get('description') ?? ''),
    siteOrgUnitId: String(formData.get('siteOrgUnitId') ?? ''),
    supervisorTenantUserId: String(formData.get('supervisorTenantUserId') ?? ''),
    operatorPersonId: String(formData.get('operatorPersonId') ?? ''),
    notes: String(formData.get('notes') ?? ''),
    segments,
  })
}
