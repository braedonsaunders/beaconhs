'use server'

import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { auditLog, crews, kioskScans, orgUnits, people } from '@beaconhs/db/schema'
import {
  db,
  normalizeKioskPin,
  primaryPersonTitleName,
  verifyKioskPin,
  type Database,
} from '@beaconhs/db'
import { resolveActiveTenant } from '@/lib/active-tenant'
import {
  guardPublicPinRateLimit,
  recordPublicPinFailure,
  resetPublicPinRateLimit,
} from '@/lib/public-pin-rate-limit'
import { isUuid } from '@/lib/list-params'
import {
  boundPickerOptions,
  PICKER_RESULT_LIMIT,
  type PickerOptionsResponse,
} from '@/lib/picker-options'
import { parseKioskPickerInput, parseKioskUnlockInput } from '@/lib/kiosk-picker'
import { remoteSearchTerm } from '@/lib/remote-search-policy'

type RecordKioskScanInput = {
  tenantId: string
  personId: string
  kind: 'in' | 'out'
  siteOrgUnitId: string | null
  crewId: string | null
  deviceLabel: string | null
  pin: string
}

type KioskAccessFailure = { ok: false; error: string }

async function withVerifiedKioskScope<T>(
  tenantId: string,
  pin: string,
  operation: (tx: Database) => Promise<T>,
): Promise<{ ok: true; value: T } | KioskAccessFailure> {
  const pinLimit = await guardPublicPinRateLimit('people-kiosk', tenantId)
  if (!pinLimit.ok) return { ok: false, error: pinLimit.error }
  return db.transaction(async (tx) => {
    const scopedTx = tx as unknown as Database
    const tenant = await resolveActiveTenant(scopedTx, { id: tenantId })
    if (!tenant) return { ok: false, error: 'Workspace unavailable' }
    if (!tenant.kioskPin) return { ok: false, error: 'Kiosk PIN not configured for this tenant' }
    if (!(await verifyKioskPin(tenant.kioskPin, pin))) {
      const recorded = await recordPublicPinFailure(pinLimit.handle)
      if (!recorded.ok) return { ok: false, error: recorded.error }
      return { ok: false, error: 'Invalid PIN' }
    }
    await resetPublicPinRateLimit(pinLimit.handle)
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`)
    return { ok: true, value: await operation(scopedTx) }
  })
}

export async function unlockKiosk(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let parsed: ReturnType<typeof parseKioskUnlockInput>
  try {
    parsed = parseKioskUnlockInput(input)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid kiosk request' }
  }
  const access = await withVerifiedKioskScope(parsed.tenantId, parsed.pin, async () => undefined)
  return access.ok ? { ok: true } : access
}

/**
 * PIN-gated, tenant-scoped, bounded directories for the public people kiosk.
 * The unlock action deliberately returns no roster: every option query is
 * independently authorized and selected values are hydrated through the same
 * visibility predicate.
 */
export async function loadKioskOptions(input: unknown): Promise<PickerOptionsResponse> {
  const parsed = parseKioskPickerInput(input)
  const term = remoteSearchTerm(parsed.search.query)
  const selected = parsed.search.selected
  const access = await withVerifiedKioskScope(parsed.tenantId, parsed.pin, async (tx) => {
    if (parsed.kind === 'person') {
      const match = term
        ? or(
            ilike(people.firstName, term),
            ilike(people.lastName, term),
            ilike(people.employeeNo, term),
            ilike(primaryPersonTitleName(people.id, people.tenantId), term),
            ilike(sql<string>`(${people.firstName} || ' ' || ${people.lastName})`, term),
            selected ? eq(people.id, selected) : undefined,
          )
        : selected
          ? eq(people.id, selected)
          : undefined
      const rows = await tx
        .select({
          id: people.id,
          firstName: people.firstName,
          lastName: people.lastName,
          employeeNo: people.employeeNo,
          jobTitle: primaryPersonTitleName(people.id, people.tenantId),
        })
        .from(people)
        .where(
          and(
            eq(people.tenantId, parsed.tenantId),
            eq(people.status, 'active'),
            isNull(people.deletedAt),
            match,
          ),
        )
        .orderBy(
          ...(selected ? [desc(sql`${people.id} = ${selected}`)] : []),
          asc(people.lastName),
          asc(people.firstName),
          asc(people.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) => ({
          value: row.id,
          label: `${row.firstName} ${row.lastName}`.trim().slice(0, 240),
          ...([row.employeeNo, row.jobTitle].filter(Boolean).length > 0
            ? {
                hint: [row.employeeNo, row.jobTitle]
                  .filter(Boolean)
                  .join(' · ')
                  .trim()
                  .slice(0, 120),
              }
            : {}),
        })),
      )
    }

    if (parsed.kind === 'site') {
      const match = term
        ? or(
            ilike(orgUnits.name, term),
            ilike(orgUnits.code, term),
            selected ? eq(orgUnits.id, selected) : undefined,
          )
        : selected
          ? eq(orgUnits.id, selected)
          : undefined
      const rows = await tx
        .select({ id: orgUnits.id, name: orgUnits.name, code: orgUnits.code })
        .from(orgUnits)
        .where(
          and(
            eq(orgUnits.tenantId, parsed.tenantId),
            eq(orgUnits.level, 'site'),
            isNull(orgUnits.deletedAt),
            match,
          ),
        )
        .orderBy(
          ...(selected ? [desc(sql`${orgUnits.id} = ${selected}`)] : []),
          asc(orgUnits.name),
          asc(orgUnits.id),
        )
        .limit(PICKER_RESULT_LIMIT + 1)
      return boundPickerOptions(
        rows.map((row) => ({
          value: row.id,
          label: row.name.trim().slice(0, 240),
          ...(row.code ? { hint: row.code.trim().slice(0, 120) } : {}),
        })),
      )
    }

    const match = term
      ? or(ilike(crews.name, term), selected ? eq(crews.id, selected) : undefined)
      : selected
        ? eq(crews.id, selected)
        : undefined
    const rows = await tx
      .select({ id: crews.id, name: crews.name })
      .from(crews)
      .where(and(eq(crews.tenantId, parsed.tenantId), match))
      .orderBy(
        ...(selected ? [desc(sql`${crews.id} = ${selected}`)] : []),
        asc(crews.name),
        asc(crews.id),
      )
      .limit(PICKER_RESULT_LIMIT + 1)
    return boundPickerOptions(
      rows.map((row) => ({ value: row.id, label: row.name.trim().slice(0, 240) })),
    )
  })
  if (!access.ok) throw new Error(access.error)
  return access.value
}

export async function recordKioskScan(
  input: RecordKioskScanInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const allowedKeys = new Set([
    'tenantId',
    'personId',
    'kind',
    'siteOrgUnitId',
    'crewId',
    'deviceLabel',
    'pin',
  ])
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowedKeys.has(key)) ||
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
  if (!pin) return { ok: false, error: 'Kiosk PIN must be 4–12 digits.' }

  const access = await withVerifiedKioskScope(
    input.tenantId,
    pin,
    async (tx): Promise<{ id: string } | { error: string }> => {
      // Mirror the person picker: only active, non-deleted
      // people may record scans — the action takes personId directly, so an
      // existence check alone would accept terminated or soft-deleted people.
      const [person] = await tx
        .select({ id: people.id })
        .from(people)
        .where(
          and(
            eq(people.tenantId, input.tenantId),
            eq(people.id, input.personId),
            eq(people.status, 'active'),
            isNull(people.deletedAt),
          ),
        )
        .limit(1)
      if (!person) return { error: 'Selected person is not valid for this tenant' } as const
      if (input.siteOrgUnitId) {
        const [site] = await tx
          .select({ id: orgUnits.id })
          .from(orgUnits)
          .where(
            and(
              eq(orgUnits.tenantId, input.tenantId),
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
          .where(and(eq(crews.tenantId, input.tenantId), eq(crews.id, input.crewId)))
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
    },
  )
  if (!access.ok) return access
  const scanId = access.value
  if ('error' in scanId) return { ok: false, error: scanId.error }
  return { ok: true, id: scanId.id }
}
