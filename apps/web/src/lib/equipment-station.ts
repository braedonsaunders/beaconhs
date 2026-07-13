// Equipment Station — shared, context-free core for scan-driven check in/out.
//
// Both surfaces call into here so the rules live in exactly one place:
//   - the in-app station  (/equipment/station)      → authed, ctx.db(...)
//   - the public kiosk    (/equipment-kiosk?t=slug)  → PIN-gated, app.tenant_id
//
// Every function takes a `Database` handle (a tenant-scoped transaction) so the
// caller owns RLS scoping + auditing. Nothing here touches RequestContext.

import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  equipmentCheckouts,
  equipmentItems,
  equipmentLocationHistory,
  equipmentTypes,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { isUuid } from './list-params'

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
    typeof input.returnedNotes !== 'string'
  ) {
    return null
  }
  const returnedNotes =
    typeof input.returnedNotes === 'string' ? input.returnedNotes.trim().slice(0, 2_000) : null

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
 * asset tag / name; people on name / employee number. "out" uses the cached
 * availability flag so it lines up with the equipment register's filter.
 */
export async function searchStationCore(
  tx: Database,
  rawQuery: string,
  limit = 24,
): Promise<StationSearchResults> {
  const q = cleanCode(rawQuery)
  if (q.length < 1) return { equipment: [], people: [] }
  const like = `%${q}%`

  const equipmentRows = await tx
    .select({
      id: equipmentItems.id,
      assetTag: equipmentItems.assetTag,
      name: equipmentItems.name,
      available: equipmentItems.isAvailableForCheckout,
      typeName: equipmentTypes.name,
      holderFirst: people.firstName,
      holderLast: people.lastName,
    })
    .from(equipmentItems)
    .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
    .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
    .where(
      and(
        isNull(equipmentItems.deletedAt),
        or(ilike(equipmentItems.assetTag, like), ilike(equipmentItems.name, like)),
      ),
    )
    .orderBy(equipmentItems.assetTag)
    .limit(limit)

  const peopleRows = await tx
    .select({
      id: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      jobTitle: people.jobTitle,
      employeeNo: people.employeeNo,
    })
    .from(people)
    .where(
      and(
        isNull(people.deletedAt),
        eq(people.status, 'active'),
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
      isOut: !r.available,
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
    .where(eq(people.id, personId))
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
    .where(eq(orgUnits.id, orgUnitId))
    .limit(1)
  return o?.name ?? null
}

/**
 * Perform a station scan: toggle (default) or a forced direction.
 *
 * Truth source for state = the checkout ledger (an open `equipment_checkouts`
 * row means the asset is out). Check-in snaps the asset back to the tenant's
 * home location (`homeOrgUnitId`) so nobody picks it each time.
 *
 * Returns a structured result the caller turns into UI feedback + an audit row.
 * It never throws on the expected "not found / wrong state" paths.
 */
export async function stationScanCore(
  tx: Database,
  args: StationScanInput & {
    tenantId: string
    homeOrgUnitId: string | null
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
      available: equipmentItems.isAvailableForCheckout,
    })
    .from(equipmentItems)
    .where(
      and(
        isNull(equipmentItems.deletedAt),
        or(eq(equipmentItems.qrToken, code), eq(equipmentItems.assetTag, code)),
      ),
    )
    .limit(1)
  if (!item) {
    // Not equipment — a person badge (employee number) sets the active holder.
    const [p] = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        jobTitle: people.jobTitle,
      })
      .from(people)
      .where(
        and(isNull(people.deletedAt), eq(people.status, 'active'), eq(people.employeeNo, code)),
      )
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

  const [open] = await tx
    .select({ id: equipmentCheckouts.id })
    .from(equipmentCheckouts)
    .where(
      and(eq(equipmentCheckouts.equipmentItemId, item.id), isNull(equipmentCheckouts.returnedAt)),
    )
    .orderBy(desc(equipmentCheckouts.checkedOutAt))
    .limit(1)
  // An asset is "out" if it has an open checkout OR the cached availability flag
  // says it isn't available — the exact predicate the equipment register's
  // "Currently checked out" filter uses (covers items assigned/transferred
  // directly, without a checkout ledger row).
  const isOut = Boolean(open) || !item.available

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
    if (isOut) {
      return { ok: false, error: `${item.assetTag} is already checked out` }
    }
    if (item.status !== 'in_service') {
      return { ok: false, error: `${item.assetTag} is ${item.status.replace(/_/g, ' ')}` }
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
  const homeOrgUnitId = args.homeOrgUnitId
  if (!homeOrgUnitId) {
    return { ok: false, error: 'Set a default check-in location before checking equipment in' }
  }
  const homeName = await locationName(tx, homeOrgUnitId)
  if (!homeName) {
    return {
      ok: false,
      error: 'Set a valid default check-in location before checking equipment in',
    }
  }
  const condition: ReturnCondition = args.condition ?? 'good'
  if (open) {
    await tx
      .update(equipmentCheckouts)
      .set({
        returnedAt: new Date(),
        returnedCondition: condition,
        returnedNotes: args.returnedNotes ?? null,
        checkedInByTenantUserId: args.actorTenantUserId,
      })
      .where(eq(equipmentCheckouts.id, open.id))
  }
  await tx
    .update(equipmentItems)
    .set({
      currentHolderPersonId: null,
      currentSiteOrgUnitId: homeOrgUnitId,
      lastSeenSiteOrgUnitId: homeOrgUnitId,
      lastSeenAt: new Date(),
      isAvailableForCheckout: item.status === 'in_service',
    })
    .where(eq(equipmentItems.id, item.id))
  await tx.insert(equipmentLocationHistory).values({
    tenantId: args.tenantId,
    itemId: item.id,
    siteOrgUnitId: homeOrgUnitId,
    holderPersonId: null,
    recordedByTenantUserId: args.actorTenantUserId,
    note: `Checked in (${condition}) at station${args.returnedNotes ? ` — ${args.returnedNotes}` : ''}`,
  })
  return {
    ok: true,
    action: 'checked_in',
    itemId: item.id,
    assetTag: item.assetTag,
    itemName: item.name,
    holderName: null,
    locationName: homeName,
    checkoutId: open?.id ?? null,
  }
}
