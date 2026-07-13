'use server'

import { and, eq, isNull, sql } from 'drizzle-orm'
import { auditLog, crews, kioskScans, orgUnits, people } from '@beaconhs/db/schema'
import { db, normalizeKioskPin, verifyKioskPin, type Database } from '@beaconhs/db'
import { resolveActiveTenant } from '@/lib/active-tenant'
import {
  guardPublicPinRateLimit,
  recordPublicPinFailure,
  resetPublicPinRateLimit,
} from '@/lib/public-pin-rate-limit'
import { isUuid } from '@/lib/list-params'

export type KioskDirectory = {
  people: { id: string; firstName: string; lastName: string; jobTitle: string | null }[]
  sites: { id: string; name: string }[]
  crews: { id: string; name: string }[]
}

type RecordKioskScanInput = {
  tenantId: string
  personId: string
  kind: 'in' | 'out'
  siteOrgUnitId: string | null
  crewId: string | null
  deviceLabel: string | null
  pin: string
}

export async function unlockKiosk(input: {
  tenantId: string
  pin: string
}): Promise<{ ok: true; directory: KioskDirectory } | { ok: false; error: string }> {
  if (
    !input ||
    typeof input !== 'object' ||
    !isUuid(input.tenantId) ||
    typeof input.pin !== 'string'
  ) {
    return { ok: false, error: 'Invalid kiosk request' }
  }
  const pin = normalizeKioskPin(input.pin)
  if (!input.tenantId || !pin) return { ok: false, error: 'PIN required' }
  const pinLimit = await guardPublicPinRateLimit('people-kiosk', input.tenantId)
  if (!pinLimit.ok) return { ok: false, error: pinLimit.error }
  return db.transaction(async (tx) => {
    const tenant = await resolveActiveTenant(tx as unknown as Database, { id: input.tenantId })
    if (!tenant) return { ok: false, error: 'Workspace unavailable' }
    if (!tenant.kioskPin) return { ok: false, error: 'Kiosk PIN not configured for this tenant' }
    if (!(await verifyKioskPin(tenant.kioskPin, pin))) {
      const recorded = await recordPublicPinFailure(pinLimit.handle)
      if (!recorded.ok) return { ok: false, error: recorded.error }
      return { ok: false, error: 'Invalid PIN' }
    }
    await resetPublicPinRateLimit(pinLimit.handle)

    await tx.execute(sql`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`)
    const [peopleRows, siteRows, crewRows] = await Promise.all([
      tx
        .select({
          id: people.id,
          firstName: people.firstName,
          lastName: people.lastName,
          jobTitle: people.jobTitle,
        })
        .from(people)
        .where(and(eq(people.status, 'active'), isNull(people.deletedAt)))
        .orderBy(people.lastName, people.firstName),
      tx
        .select({ id: orgUnits.id, name: orgUnits.name })
        .from(orgUnits)
        .where(and(eq(orgUnits.level, 'site'), isNull(orgUnits.deletedAt)))
        .orderBy(orgUnits.name),
      tx.select({ id: crews.id, name: crews.name }).from(crews).orderBy(crews.name),
    ])
    return { ok: true, directory: { people: peopleRows, sites: siteRows, crews: crewRows } }
  })
}

export async function recordKioskScan(
  input: RecordKioskScanInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (
    !input ||
    typeof input !== 'object' ||
    !isUuid(input.tenantId) ||
    !isUuid(input.personId) ||
    (input.siteOrgUnitId !== null && !isUuid(input.siteOrgUnitId)) ||
    (input.crewId !== null && !isUuid(input.crewId)) ||
    (input.deviceLabel !== null &&
      (typeof input.deviceLabel !== 'string' || input.deviceLabel.length > 200)) ||
    typeof input.pin !== 'string'
  ) {
    return { ok: false, error: 'Invalid kiosk request' }
  }
  if (input.kind !== 'in' && input.kind !== 'out') return { ok: false, error: 'Bad kind' }
  const pin = normalizeKioskPin(input.pin)
  if (!pin) return { ok: false, error: 'PIN required' }
  const pinLimit = await guardPublicPinRateLimit('people-kiosk', input.tenantId)
  if (!pinLimit.ok) return { ok: false, error: pinLimit.error }

  // Verify the PIN against the tenant. The tenants table is global (not
  // tenant-scoped), so this read needs no special scope; the kiosk device is
  // unauthenticated and gated by the tenant slug + the PIN check below.
  const tenant = await db.transaction((tx) =>
    resolveActiveTenant(tx as unknown as Database, { id: input.tenantId }),
  )
  if (!tenant) return { ok: false, error: 'Workspace unavailable' }
  if (!tenant.kioskPin) return { ok: false, error: 'Kiosk PIN not configured for this tenant' }
  if (!(await verifyKioskPin(tenant.kioskPin, pin))) {
    const recorded = await recordPublicPinFailure(pinLimit.handle)
    if (!recorded.ok) return { ok: false, error: recorded.error }
    return { ok: false, error: 'Invalid PIN' }
  }
  await resetPublicPinRateLimit(pinLimit.handle)

  const scanId = await db.transaction(async (tx): Promise<{ id: string } | { error: string }> => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`)
    // Mirror the directory filter in unlockKiosk: only active, non-deleted
    // people may record scans — the action takes personId directly, so an
    // existence check alone would accept terminated or soft-deleted people.
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(eq(people.id, input.personId), eq(people.status, 'active'), isNull(people.deletedAt)),
      )
      .limit(1)
    if (!person) return { error: 'Selected person is not valid for this tenant' } as const
    if (input.siteOrgUnitId) {
      const [site] = await tx
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(
          and(
            eq(orgUnits.id, input.siteOrgUnitId),
            eq(orgUnits.level, 'site'),
            isNull(orgUnits.deletedAt),
          ),
        )
        .limit(1)
      if (!site) return { error: 'Selected site is not valid for this tenant' } as const
    }
    if (input.crewId) {
      const [crew] = await tx
        .select({ id: crews.id })
        .from(crews)
        .where(eq(crews.id, input.crewId))
        .limit(1)
      if (!crew) return { error: 'Selected crew is not valid for this tenant' } as const
    }
    const [row] = await tx
      .insert(kioskScans)
      .values({
        tenantId: input.tenantId,
        personId: input.personId,
        kind: input.kind,
        siteOrgUnitId: input.siteOrgUnitId,
        crewId: input.crewId,
        deviceLabel: input.deviceLabel?.trim() || null,
      })
      .returning({ id: kioskScans.id })
    if (!row) throw new Error('Failed to insert kiosk scan')

    // Inline audit (we don't have a RequestContext on the kiosk path because
    // the device is unauthenticated). recordAudit expects a ctx, so write a
    // tenant-scoped row directly.
    await tx.insert(auditLog).values({
      tenantId: input.tenantId,
      actorUserId: null,
      entityType: 'kiosk_scan',
      entityId: row.id,
      action: 'create',
      summary: `Kiosk ${input.kind === 'in' ? 'sign-in' : 'sign-out'}`,
      after: {
        personId: input.personId,
        kind: input.kind,
        siteOrgUnitId: input.siteOrgUnitId,
        crewId: input.crewId,
        deviceLabel: input.deviceLabel?.trim() || null,
      },
    })
    return { id: row.id } as const
  })
  if ('error' in scanId) return { ok: false, error: scanId.error }
  return { ok: true, id: scanId.id }
}
