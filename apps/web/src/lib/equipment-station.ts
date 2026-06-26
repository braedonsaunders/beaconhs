// Equipment Station — shared, context-free core for scan-driven check in/out.
//
// Both surfaces call into here so the rules live in exactly one place:
//   - the in-app station  (/equipment/station)      → authed, ctx.db(...)
//   - the public kiosk    (/equipment-kiosk?t=slug)  → PIN-gated, app.tenant_id
//
// Every function takes a `Database` handle (a tenant-scoped transaction) so the
// caller owns RLS scoping + auditing. Nothing here touches RequestContext.

import { and, desc, eq, isNull, or } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  equipmentCheckouts,
  equipmentItems,
  equipmentLocationHistory,
  equipmentTypes,
  orgUnits,
  people,
} from '@beaconhs/db/schema'

export const RETURN_CONDITIONS = ['good', 'fair', 'damaged', 'unusable'] as const
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number]

export type ResolvedScan =
  | {
      kind: 'equipment'
      item: {
        id: string
        assetTag: string
        name: string
        typeName: string | null
        status: string
        isOut: boolean
        holderName: string | null
        locationName: string | null
      }
    }
  | { kind: 'person'; person: { id: string; name: string; jobTitle: string | null } }
  | { kind: 'none' }

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
  /** Destination on check-out. Null = unassigned ("any location"). */
  destinationOrgUnitId?: string | null
  expectedReturnOn?: string | null
  /** undefined ⇒ toggle current state; 'out'/'in' ⇒ force that direction. */
  direction?: 'in' | 'out'
  condition?: ReturnCondition
  returnedNotes?: string | null
}

function cleanCode(raw: string): string {
  return raw.trim()
}

/** Resolve a scanned/typed code to an equipment item or a person badge. */
export async function resolveScanCore(tx: Database, rawCode: string): Promise<ResolvedScan> {
  const code = cleanCode(rawCode)
  if (!code) return { kind: 'none' }

  const [row] = await tx
    .select({
      id: equipmentItems.id,
      assetTag: equipmentItems.assetTag,
      name: equipmentItems.name,
      status: equipmentItems.status,
      typeName: equipmentTypes.name,
      holderFirst: people.firstName,
      holderLast: people.lastName,
      locationName: orgUnits.name,
    })
    .from(equipmentItems)
    .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
    .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
    .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
    .where(
      and(
        isNull(equipmentItems.deletedAt),
        or(eq(equipmentItems.qrToken, code), eq(equipmentItems.assetTag, code)),
      ),
    )
    .limit(1)

  if (row) {
    const [open] = await tx
      .select({ id: equipmentCheckouts.id })
      .from(equipmentCheckouts)
      .where(
        and(
          eq(equipmentCheckouts.equipmentItemId, row.id),
          isNull(equipmentCheckouts.returnedAt),
        ),
      )
      .limit(1)
    return {
      kind: 'equipment',
      item: {
        id: row.id,
        assetTag: row.assetTag,
        name: row.name,
        typeName: row.typeName,
        status: row.status,
        isOut: Boolean(open),
        holderName:
          row.holderFirst || row.holderLast
            ? `${row.holderFirst ?? ''} ${row.holderLast ?? ''}`.trim()
            : null,
        locationName: row.locationName,
      },
    }
  }

  // Fall back to a person badge (employee number).
  const [p] = await tx
    .select({
      id: people.id,
      firstName: people.firstName,
      lastName: people.lastName,
      jobTitle: people.jobTitle,
    })
    .from(people)
    .where(
      and(
        isNull(people.deletedAt),
        eq(people.status, 'active'),
        eq(people.employeeNo, code),
      ),
    )
    .limit(1)
  if (p) {
    return {
      kind: 'person',
      person: { id: p.id, name: `${p.firstName} ${p.lastName}`.trim(), jobTitle: p.jobTitle },
    }
  }

  return { kind: 'none' }
}

async function personName(tx: Database, personId: string | null | undefined): Promise<string | null> {
  if (!personId) return null
  const [p] = await tx
    .select({ first: people.firstName, last: people.lastName })
    .from(people)
    .where(eq(people.id, personId))
    .limit(1)
  return p ? `${p.first} ${p.last}`.trim() : null
}

async function locationName(tx: Database, orgUnitId: string | null | undefined): Promise<string | null> {
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
  const isOut = Boolean(open)

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
      holderName: await personName(tx, holderPersonId),
      locationName: await locationName(tx, destinationOrgUnitId),
      checkoutId: co?.id ?? null,
    }
  }

  // ---- check in: snap to home, clear holder, mark available -----------------
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
      currentSiteOrgUnitId: args.homeOrgUnitId,
      lastSeenSiteOrgUnitId: args.homeOrgUnitId,
      lastSeenAt: new Date(),
      isAvailableForCheckout: item.status === 'in_service',
    })
    .where(eq(equipmentItems.id, item.id))
  await tx.insert(equipmentLocationHistory).values({
    tenantId: args.tenantId,
    itemId: item.id,
    siteOrgUnitId: args.homeOrgUnitId,
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
    locationName: await locationName(tx, args.homeOrgUnitId),
    checkoutId: open?.id ?? null,
  }
}
