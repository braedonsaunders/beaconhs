import { activePeopleWhere } from '@beaconhs/db'
import { recordSearchWhere, recordSearchTerm } from './record-search'
// Equipment Station — shared, context-free core for scan-driven check in/out.
//
// Both surfaces call into here so the rules live in exactly one place:
//   - the in-app station  (/equipment/station)      → authed, ctx.db(...)
//   - the public kiosk    (/equipment-kiosk?t=slug)  → PIN-gated, app.tenant_id
//
// Every function takes a `Database` handle (a tenant-scoped transaction) so the
// caller owns RLS scoping + auditing. Nothing here touches RequestContext.

import { and, eq, ilike, isNull, or } from 'drizzle-orm'
import { primaryPersonTitleName, type Database } from '@beaconhs/db'
import {
  equipmentCheckouts,
  equipmentItems,
  equipmentLocationHistory,
  equipmentTypes,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { isUuid } from './list-params'
import {
  equipmentIsCheckedOutSql,
  checkInEquipmentInTx,
  EquipmentCustodyError,
} from './equipment-custody'

const RETURN_CONDITIONS = ['good', 'fair', 'damaged', 'unusable'] as const
type ReturnCondition = (typeof RETURN_CONDITIONS)[number]

export type StationSearchResults = {
  equipment: {
    id: string
    assetTag: string
    name: string
    typeName: string | null
    isOut: boolean
    holderName: string | null
  }[]
  people: { id: string; name: string; jobTitle: string | null; employeeNo: string | null }[]
}

export type StationScanResult =
  | {
      ok: true
      action: 'checked_out' | 'checked_in'
      itemId: string
      assetTag: string
      itemName: string
      holderName: string | null
      locationName: string | null
      checkoutId: string | null
    }
  | {
      // A person badge was scanned — the caller adopts them as the active holder
      // for subsequent check-outs. No mutation happened.
      ok: true
      action: 'active_person'
      personId: string
      personName: string
      jobTitle: string | null
    }
  | { ok: false; error: string }

export type StationScanInput = {
  code: string
  /** Person taking the asset on check-out. */
  activePersonId?: string | null
  /** Destination on check-out. Required before an asset can leave the station. */
  destinationOrgUnitId?: string | null
  expectedReturnOn?: string | null
  /** undefined ⇒ toggle current state; 'out'/'in' ⇒ force that direction. */
  direction?: 'in' | 'out'
  condition?: ReturnCondition
  returnedNotes?: string | null
}

export function parseStationScanInput(value: unknown): StationScanInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (typeof input.code !== 'string') return null
  const code = input.code.trim()
  if (!code || code.length > 200) return null

  const optionalUuid = (candidate: unknown): string | null | undefined => {
    if (candidate === undefined) return undefined
    if (candidate === null || candidate === '') return null
    return typeof candidate === 'string' && isUuid(candidate) ? candidate : undefined
  }
  const activePersonId = optionalUuid(input.activePersonId)
  const destinationOrgUnitId = optionalUuid(input.destinationOrgUnitId)
  if (input.activePersonId !== undefined && activePersonId === undefined) return null
  if (input.destinationOrgUnitId !== undefined && destinationOrgUnitId === undefined) return null

  if (input.direction !== undefined && input.direction !== 'in' && input.direction !== 'out') {
    return null
  }
  if (
    input.condition !== undefined &&
    (typeof input.condition !== 'string' ||
      !RETURN_CONDITIONS.includes(input.condition as ReturnCondition))
  ) {
    return null
  }
  let expectedReturnOn: string | null | undefined
  if (input.expectedReturnOn === undefined) expectedReturnOn = undefined
  else if (input.expectedReturnOn === null || input.expectedReturnOn === '') expectedReturnOn = null
  else if (typeof input.expectedReturnOn === 'string') {
    const date = new Date(`${input.expectedReturnOn}T00:00:00.000Z`)
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(input.expectedReturnOn) ||
      Number.isNaN(date.valueOf()) ||
      date.toISOString().slice(0, 10) !== input.expectedReturnOn
    ) {
      return null
    }
    expectedReturnOn = input.expectedReturnOn
  } else return null

  if (
    input.returnedNotes !== undefined &&
    input.returnedNotes !== null &&
    (typeof input.returnedNotes !== 'string' || input.returnedNotes.length > 2_000)
  ) {
    return null
  }
  const returnedNotes = typeof input.returnedNotes === 'string' ? input.returnedNotes.trim() : null

  return {
    code,
    activePersonId,
    destinationOrgUnitId,
    expectedReturnOn,
    direction: input.direction as 'in' | 'out' | undefined,
    condition: input.condition as ReturnCondition | undefined,
    returnedNotes,
  }
}

function cleanCode(raw: string): string {
  return raw.trim()
}

/**
 * Typeahead for the station field: surface matching assets + people as the
 * operator types (so they don't need an exact scan). Equipment is matched on
 * the shared equipment identifiers and details; people on name / employee number. Physical custody uses the same
 * predicate as the equipment detail page and register.
 */
export async function searchStationCore(
  tx: Database,
  rawQuery: string,
  limit = 24,
): Promise<StationSearchResults> {
  const q = cleanCode(rawQuery)
  if (q.length < 1) return { equipment: [], people: [] }
  const like = recordSearchTerm(q)

  const equipmentRows = await tx
    .select({
      id: equipmentItems.id,
      assetTag: equipmentItems.assetTag,
      name: equipmentItems.name,
      isOut: equipmentIsCheckedOutSql,
      typeName: equipmentTypes.name,
      holderFirst: people.firstName,
      holderLast: people.lastName,
    })
    .from(equipmentItems)
    .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
    .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
    .where(and(isNull(equipmentItems.deletedAt), recordSearchWhere('equipment', q)))
    .orderBy(equipmentItems.assetTag)
    .limit(limit)

  const peopleRows = await tx
    .select({
      id: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      jobTitle: primaryPersonTitleName(people.id, people.tenantId),
      employeeNo: people.employeeNo,
    })
    .from(people)
    .where(
      and(
        activePeopleWhere(),
        or(
          ilike(people.firstName, like),
          ilike(people.lastName, like),
          ilike(people.employeeNo, like),
        ),
      ),
    )
    .orderBy(people.lastName, people.firstName)
    .limit(limit)

  return {
    equipment: equipmentRows.map((r) => ({
      id: r.id,
      assetTag: r.assetTag,
      name: r.name,
      typeName: r.typeName,
      isOut: r.isOut,
      holderName:
        r.holderFirst || r.holderLast
          ? `${r.holderFirst ?? ''} ${r.holderLast ?? ''}`.trim()
          : null,
    })),
    people: peopleRows.map((p) => ({
      id: p.id,
      name: `${p.firstName} ${p.lastName}`.trim(),
      jobTitle: p.jobTitle,
      employeeNo: p.employeeNo,
    })),
  }
}

async function personName(
  tx: Database,
  personId: string | null | undefined,
): Promise<string | null> {
  if (!personId) return null
  const [p] = await tx
    .select({ first: people.firstName, last: people.lastName })
    .from(people)
    .where(and(eq(people.id, personId), activePeopleWhere()))
    .limit(1)
  return p ? `${p.first} ${p.last}`.trim() : null
}

async function locationName(
  tx: Database,
  orgUnitId: string | null | undefined,
): Promise<string | null> {
  if (!orgUnitId) return null
  const [o] = await tx
    .select({ name: orgUnits.name })
    .from(orgUnits)
    .where(and(eq(orgUnits.id, orgUnitId), isNull(orgUnits.deletedAt)))
    .limit(1)
  return o?.name ?? null
}

/**
 * Perform a station scan: toggle (default) or a forced direction.
 *
 * Custody state is shared with the detail page and register: an open checkout,
 * a holder, or an off-base location means out. Check-in returns it to the
 * configured home location.
 *
 * Returns a structured result the caller turns into UI feedback + an audit row.
 * It never throws on the expected "not found / wrong state" paths.
 */
export async function stationScanCore(
  tx: Database,
  args: StationScanInput & {
    tenantId: string
    actorTenantUserId: string | null
    requireHolderOnCheckout: boolean
  },
): Promise<StationScanResult> {
  const code = cleanCode(args.code)
  if (!code) return { ok: false, error: 'Empty scan' }

  const [item] = await tx
    .select({
      id: equipmentItems.id,
      assetTag: equipmentItems.assetTag,
      name: equipmentItems.name,
      status: equipmentItems.status,
      isOut: equipmentIsCheckedOutSql,
      isMissing: equipmentItems.isMissing,
    })
    .from(equipmentItems)
    .where(
      and(
        isNull(equipmentItems.deletedAt),
        or(eq(equipmentItems.qrToken, code), eq(equipmentItems.assetTag, code)),
      ),
    )
    .limit(1)
    .for('update')
  if (!item) {
    // Not equipment — a person badge (employee number) sets the active holder.
    const [p] = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        jobTitle: primaryPersonTitleName(people.id, people.tenantId),
      })
      .from(people)
      .where(and(activePeopleWhere(), eq(people.employeeNo, code)))
      .limit(1)
    if (p) {
      return {
        ok: true,
        action: 'active_person',
        personId: p.id,
        personName: `${p.firstName} ${p.lastName}`.trim(),
        jobTitle: p.jobTitle,
      }
    }
    return { ok: false, error: `No equipment or badge matches “${code}”` }
  }

  const isOut = item.isOut

  // Resolve the action: toggle inverts current state; explicit forces it.
  const action: 'checked_out' | 'checked_in' =
    args.direction === 'out'
      ? 'checked_out'
      : args.direction === 'in'
        ? 'checked_in'
        : isOut
          ? 'checked_in'
          : 'checked_out'

  if (action === 'checked_out') {
    if (item.isMissing) {
      return { ok: false, error: `${item.assetTag} is reported missing` }
    }
    if (item.status !== 'in_service') {
      return { ok: false, error: `${item.assetTag} is ${item.status.replace(/_/g, ' ')}` }
    }
    if (isOut) {
      return { ok: false, error: `${item.assetTag} is already checked out` }
    }
    const holderPersonId = args.activePersonId ?? null
    if (args.requireHolderOnCheckout && !holderPersonId) {
      return { ok: false, error: 'Scan or pick a person before checking out' }
    }
    const destinationOrgUnitId = args.destinationOrgUnitId ?? null
    if (!destinationOrgUnitId) {
      return { ok: false, error: 'Pick a check-out destination before checking out' }
    }
    const destinationName = await locationName(tx, destinationOrgUnitId)
    if (!destinationName) {
      return { ok: false, error: 'Pick a valid check-out destination' }
    }
    const holderName = holderPersonId ? await personName(tx, holderPersonId) : null
    if (holderPersonId && holderName === null) {
      return { ok: false, error: 'Pick a valid holder before checking out' }
    }

    const [co] = await tx
      .insert(equipmentCheckouts)
      .values({
        tenantId: args.tenantId,
        equipmentItemId: item.id,
        holderPersonId,
        destinationOrgUnitId,
        expectedReturnOn: args.expectedReturnOn ?? null,
        notes: 'Checked out at station',
        checkedOutByTenantUserId: args.actorTenantUserId,
      })
      .returning({ id: equipmentCheckouts.id })
    await tx
      .update(equipmentItems)
      .set({
        currentHolderPersonId: holderPersonId,
        currentSiteOrgUnitId: destinationOrgUnitId,
        lastSeenHolderPersonId: holderPersonId,
        lastSeenSiteOrgUnitId: destinationOrgUnitId,
        lastSeenAt: new Date(),
        isAvailableForCheckout: false,
        isMissing: false,
      })
      .where(eq(equipmentItems.id, item.id))
    await tx.insert(equipmentLocationHistory).values({
      tenantId: args.tenantId,
      itemId: item.id,
      siteOrgUnitId: destinationOrgUnitId,
      holderPersonId,
      recordedByTenantUserId: args.actorTenantUserId,
      movementKind: 'check_out',
      note: 'Checked out at station',
    })
    return {
      ok: true,
      action: 'checked_out',
      itemId: item.id,
      assetTag: item.assetTag,
      itemName: item.name,
      holderName,
      locationName: destinationName,
      checkoutId: co?.id ?? null,
    }
  }

  // ---- check in: snap to home, clear holder, mark available -----------------
  if (!isOut) {
    return { ok: false, error: `${item.assetTag} is already checked in` }
  }
  let result
  try {
    result = await checkInEquipmentInTx(tx, {
      tenantId: args.tenantId,
      itemId: item.id,
      actorTenantUserId: args.actorTenantUserId,
      actorPersonId: null,
      canManage: true,
      condition: args.condition ?? 'good',
      notes: args.returnedNotes ?? null,
    })
  } catch (error) {
    if (error instanceof EquipmentCustodyError) return { ok: false, error: error.message }
    throw error
  }
  if (!result) return { ok: false, error: `${item.assetTag} is already checked in` }
  return {
    ok: true,
    action: 'checked_in',
    itemId: item.id,
    assetTag: item.assetTag,
    itemName: item.name,
    holderName: null,
    locationName: result.locationName,
    checkoutId: result.checkoutId,
  }
}
