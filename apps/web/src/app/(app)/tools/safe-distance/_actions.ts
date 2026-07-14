'use server'

// Safe Distance writes are safety-record mutations. Every action is permission
// gated, tenant-scoped, runtime validated, serialized on the parent row, and
// audited inside the same database transaction as the business write.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { audit, type AuditEvent } from '@beaconhs/audit'
import type { Database } from '@beaconhs/db'
import {
  orgUnits,
  people,
  safeDistanceRecords,
  safeDistanceSegments,
  tenantUsers,
} from '@beaconhs/db/schema'
import { assertCan, type RequestContext } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { nextReference } from '@/lib/reference'
import { isUuid } from '@/lib/list-params'
import { SAFE_DISTANCE_PERMISSION } from '@/lib/safe-distance-access'
import { segmentVolumeM3 } from './_lib'
import { MAX_SAFE_DISTANCE_FORM_SEGMENTS_BYTES } from './_constraints'
import {
  evaluateSafeDistanceState,
  parseSafeDistanceIdentity,
  parseSafeDistanceSave,
} from './_mutation-policy'

export type ActionResult =
  { ok: true; version?: string } | { ok: false; error: string; reason?: 'locked' | 'conflict' }

type SafeDistanceAuditEvent = Omit<AuditEvent, 'tenantId' | 'actorUserId'>

async function auditInTransaction(
  tx: Database,
  ctx: RequestContext,
  event: SafeDistanceAuditEvent,
): Promise<void> {
  const impersonation = ctx.impersonation
  const syntheticApiActor = Boolean(ctx.apiKey && ctx.userId === `api_key:${ctx.apiKey.id}`)
  await audit(tx, {
    ...event,
    tenantId: ctx.tenantId,
    actorUserId: syntheticApiActor ? null : ctx.userId,
    summary: impersonation && event.summary ? `[impersonated] ${event.summary}` : event.summary,
    metadata: {
      ...(event.metadata ?? {}),
      ...(ctx.apiKey
        ? { actorKind: 'api_key', apiKeyId: ctx.apiKey.id, apiKeyName: ctx.apiKey.name }
        : {}),
      ...(impersonation
        ? {
            impersonatorUserId: impersonation.actor.userId,
            impersonatorName: impersonation.actor.name,
          }
        : {}),
    },
  })
}

async function validateReferences(
  tx: Database,
  refs: {
    siteOrgUnitId: string | null
    supervisorTenantUserId: string | null
    operatorPersonId: string | null
  },
): Promise<string | null> {
  if (refs.siteOrgUnitId) {
    const [site] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(
        and(
          eq(orgUnits.id, refs.siteOrgUnitId),
          eq(orgUnits.level, 'site'),
          isNull(orgUnits.deletedAt),
        ),
      )
      .limit(1)
    if (!site) return 'The selected site is not available in this workspace.'
  }
  if (refs.supervisorTenantUserId) {
    const [supervisor] = await tx
      .select({ id: tenantUsers.id })
      .from(tenantUsers)
      .where(and(eq(tenantUsers.id, refs.supervisorTenantUserId), eq(tenantUsers.status, 'active')))
      .limit(1)
    if (!supervisor) return 'The selected supervisor is not an active workspace member.'
  }
  if (refs.operatorPersonId) {
    const [operator] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.id, refs.operatorPersonId),
          eq(people.status, 'active'),
          isNull(people.deletedAt),
        ),
      )
      .limit(1)
    if (!operator) return 'The selected operator is not an active person in this workspace.'
  }
  return null
}

function requireSafeDistance(ctx: RequestContext): void {
  assertCan(ctx, SAFE_DISTANCE_PERMISSION)
}

// ---------- Create ------------------------------------------------------

/** Create a canonical blank draft, then redirect into the calculator. */
export async function createSafeDistanceRecord(_formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  requireSafeDistance(ctx)

  const row = await ctx.db(async (tx) => {
    const reference = await nextReference(tx, ctx.tenantId, 'safe_distance')
    const [created] = await tx
      .insert(safeDistanceRecords)
      .values({
        tenantId: ctx.tenantId,
        reference,
        name: 'New pressure test',
        method: 'nasa',
        unit: 'imperial',
        testPressure: '0',
        occurredAt: new Date(),
      })
      .returning()
    if (!created) throw new Error('Safe Distance assessment could not be created.')
    await auditInTransaction(tx, ctx, {
      entityType: 'safe_distance_record',
      entityId: created.id,
      action: 'create',
      summary: `Created ${created.reference} (${created.name})`,
      after: { name: created.name, method: created.method, unit: created.unit },
    })
    return created
  })

  revalidatePath('/tools/safe-distance')
  redirect(`/tools/safe-distance/${row.id}`)
}

// ---------- Save (authoritative recompute) ------------------------------

async function saveSafeDistanceRecord(
  input: unknown,
): Promise<ActionResult & { results?: ReturnType<typeof import('./_lib').computeSafeDistance> }> {
  const ctx = await requireRequestContext()
  requireSafeDistance(ctx)
  const parsed = parseSafeDistanceSave(input)
  if (!parsed.ok) return parsed
  const value = parsed.value

  const outcome = await ctx.db(async (tx) => {
    const [record] = await tx
      .select()
      .from(safeDistanceRecords)
      .where(and(eq(safeDistanceRecords.id, value.id), isNull(safeDistanceRecords.deletedAt)))
      .for('update')
      .limit(1)
    if (!record) return { ok: false as const, error: 'Assessment not found.' }

    const state = evaluateSafeDistanceState(record, value.version, { kind: 'save' })
    if (!state.ok) return state

    const referenceError = await validateReferences(tx, value)
    if (referenceError) return { ok: false as const, error: referenceError }
    const nextUpdatedAt = new Date(Math.max(Date.now(), record.updatedAt.getTime() + 1))

    const [updated] = await tx
      .update(safeDistanceRecords)
      .set({
        name: value.name,
        method: value.method,
        unit: value.unit,
        testPressure: String(value.testPressure),
        description: value.description,
        siteOrgUnitId: value.siteOrgUnitId,
        supervisorTenantUserId: value.supervisorTenantUserId,
        operatorPersonId: value.operatorPersonId,
        notes: value.notes,
        totalVolume: String(value.results.totalVolume),
        resultNasa: String(value.results.nasa),
        resultAsme: String(value.results.asme),
        resultLloyds: String(value.results.lloyds),
        updatedAt: nextUpdatedAt,
      })
      .where(eq(safeDistanceRecords.id, value.id))
      .returning({ updatedAt: safeDistanceRecords.updatedAt })
    if (!updated) return { ok: false as const, error: 'Assessment not found.' }

    await tx.delete(safeDistanceSegments).where(eq(safeDistanceSegments.recordId, value.id))
    await tx.insert(safeDistanceSegments).values(
      value.segments.map((segment, index) => ({
        tenantId: ctx.tenantId,
        recordId: value.id,
        name: segment.name,
        unit: segment.unit,
        lengthValue: String(segment.lengthValue),
        internalDiameter: String(segment.internalDiameter),
        volumeM3: String(
          segmentVolumeM3(segment.lengthValue, segment.internalDiameter, segment.unit),
        ),
        sortOrder: index,
      })),
    )

    await auditInTransaction(tx, ctx, {
      entityType: 'safe_distance_record',
      entityId: value.id,
      action: 'update',
      summary: `Updated calculation (${value.segments.length} segment${value.segments.length === 1 ? '' : 's'})`,
      before: {
        name: record.name,
        method: record.method,
        unit: record.unit,
        testPressure: record.testPressure,
        totalVolume: record.totalVolume,
      },
      after: {
        name: value.name,
        method: value.method,
        unit: value.unit,
        testPressure: value.testPressure,
        totalVolume: value.results.totalVolume,
        chosen: value.results.chosen,
      },
    })
    return {
      ok: true as const,
      version: updated.updatedAt.toISOString(),
      results: value.results,
    }
  })

  if (outcome.ok) {
    revalidatePath(`/tools/safe-distance/${value.id}`)
    revalidatePath('/tools/safe-distance')
  }
  return outcome
}

// ---------- Lock / unlock / delete ------------------------------------

async function setSafeDistanceLock(raw: unknown, desiredLocked: boolean): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  requireSafeDistance(ctx)
  const parsed = parseSafeDistanceIdentity(raw)
  if (!parsed.ok) return parsed
  const { id, version } = parsed.value

  const outcome = await ctx.db(async (tx) => {
    const [record] = await tx
      .select()
      .from(safeDistanceRecords)
      .where(and(eq(safeDistanceRecords.id, id), isNull(safeDistanceRecords.deletedAt)))
      .for('update')
      .limit(1)
    if (!record) return { ok: false as const, error: 'Assessment not found.' }

    const state = evaluateSafeDistanceState(record, version, {
      kind: 'set_lock',
      locked: desiredLocked,
    })
    if (!state.ok) return state
    if (!state.changed) return { ok: true as const, version: record.updatedAt.toISOString() }
    const nextUpdatedAt = new Date(Math.max(Date.now(), record.updatedAt.getTime() + 1))

    const [updated] = await tx
      .update(safeDistanceRecords)
      .set({ locked: desiredLocked, updatedAt: nextUpdatedAt })
      .where(eq(safeDistanceRecords.id, id))
      .returning({ updatedAt: safeDistanceRecords.updatedAt })
    if (!updated) return { ok: false as const, error: 'Assessment not found.' }

    await auditInTransaction(tx, ctx, {
      entityType: 'safe_distance_record',
      entityId: id,
      action: 'update',
      summary: desiredLocked ? 'Locked assessment' : 'Unlocked assessment',
      before: { locked: record.locked },
      after: { locked: desiredLocked },
    })
    return { ok: true as const, version: updated.updatedAt.toISOString() }
  })

  if (outcome.ok) {
    revalidatePath(`/tools/safe-distance/${id}`)
    revalidatePath('/tools/safe-distance')
  }
  return outcome
}

async function lockSafeDistanceRecord(id: string, version: string): Promise<ActionResult> {
  return setSafeDistanceLock({ id, version }, true)
}

async function unlockSafeDistanceRecord(id: string, version: string): Promise<ActionResult> {
  return setSafeDistanceLock({ id, version }, false)
}

async function deleteSafeDistanceRecord(id: string, version: string): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  requireSafeDistance(ctx)
  const parsed = parseSafeDistanceIdentity({ id, version })
  if (!parsed.ok) return parsed

  const outcome = await ctx.db(async (tx) => {
    const [record] = await tx
      .select()
      .from(safeDistanceRecords)
      .where(
        and(eq(safeDistanceRecords.id, parsed.value.id), isNull(safeDistanceRecords.deletedAt)),
      )
      .for('update')
      .limit(1)
    if (!record) return { ok: false as const, error: 'Assessment not found.' }

    const state = evaluateSafeDistanceState(record, parsed.value.version, { kind: 'delete' })
    if (!state.ok) return state
    const deletedAt = new Date(Math.max(Date.now(), record.updatedAt.getTime() + 1))

    const [deleted] = await tx
      .update(safeDistanceRecords)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(eq(safeDistanceRecords.id, record.id))
      .returning({ id: safeDistanceRecords.id })
    if (!deleted) return { ok: false as const, error: 'Assessment not found.' }

    await auditInTransaction(tx, ctx, {
      entityType: 'safe_distance_record',
      entityId: record.id,
      action: 'delete',
      summary: `Deleted ${record.reference}`,
      before: { reference: record.reference, name: record.name, locked: record.locked },
    })
    return { ok: true as const }
  })

  if (outcome.ok) revalidatePath('/tools/safe-distance')
  return outcome
}

export async function deleteSafeDistanceRecordAndRedirect(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const result = await deleteSafeDistanceRecord(id, String(formData.get('version') ?? ''))
  if (!result.ok) {
    redirect(
      isUuid(id)
        ? `/tools/safe-distance/${id}?error=${encodeURIComponent(result.error)}`
        : '/tools/safe-distance',
    )
  }
  redirect('/tools/safe-distance')
}

export async function toggleLockSafeDistanceRecord(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const version = String(formData.get('version') ?? '')
  const desired = String(formData.get('desired') ?? '') === 'true'
  const result = desired
    ? await lockSafeDistanceRecord(id, version)
    : await unlockSafeDistanceRecord(id, version)
  if (!result.ok) {
    redirect(
      isUuid(id)
        ? `/tools/safe-distance/${id}?error=${encodeURIComponent(result.error)}`
        : '/tools/safe-distance',
    )
  }
}

export async function saveSafeDistanceRecordForm(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const rawSegments = String(formData.get('segments') ?? '[]')
  if (Buffer.byteLength(rawSegments, 'utf8') > MAX_SAFE_DISTANCE_FORM_SEGMENTS_BYTES) {
    return { ok: false, error: 'The pipe segment data is too large.' }
  }

  let segments: unknown
  try {
    segments = JSON.parse(rawSegments)
  } catch {
    return { ok: false, error: 'The pipe segment data is invalid.' }
  }

  const result = await saveSafeDistanceRecord({
    id: String(formData.get('id') ?? ''),
    version: String(formData.get('version') ?? ''),
    name: String(formData.get('name') ?? ''),
    method: String(formData.get('method') ?? ''),
    unit: String(formData.get('unit') ?? ''),
    testPressure: Number(formData.get('testPressure')),
    description: String(formData.get('description') ?? ''),
    siteOrgUnitId: String(formData.get('siteOrgUnitId') ?? '').trim() || null,
    supervisorTenantUserId: String(formData.get('supervisorTenantUserId') ?? '').trim() || null,
    operatorPersonId: String(formData.get('operatorPersonId') ?? '').trim() || null,
    notes: String(formData.get('notes') ?? ''),
    segments,
  })
  return result
}
