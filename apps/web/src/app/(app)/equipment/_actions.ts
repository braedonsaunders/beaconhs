'use server'

// Bulk-action server actions for /equipment.
//
// Four actions surface in the floating bulk-action bar:
//   - bulkTransferEquipmentToSite  pick orgUnit (level=site), update currentSiteOrgUnitId
//   - bulkAssignEquipmentToHolder  pick a person, update currentHolderPersonId
//   - bulkSetEquipmentStatus       change status enum on N rows
//   - bulkExportEquipmentCsv       emit CSV for just the checked rows
//
// Skips soft-deleted rows. Audit log gets one row per affected item plus a
// summary entry, all sharing a batchId in metadata.

import { revalidatePath } from 'next/cache'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import {
  equipmentCheckouts,
  equipmentItems,
  equipmentLocationHistory,
  equipmentTypes,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { assertCan, can } from '@beaconhs/tenant'
import { requireExportContext, requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { recordAudit } from '@/lib/audit'
import { csvRow } from '@/lib/csv'

type BulkActionResult =
  | { ok: true; updated: number; skipped: number }
  | { ok: false; error: string }

type BulkCsvResult = { ok: true; filename: string; content: string } | { ok: false; error: string }

const MAX_BULK = 500

function makeBatchId(): string {
  return `bat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export async function bulkTransferEquipmentToSite(args: {
  equipmentIds: string[]
  siteOrgUnitId: string
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  if (args.equipmentIds.length === 0) return { ok: false, error: 'No equipment selected.' }
  if (!args.siteOrgUnitId) return { ok: false, error: 'Pick a site.' }
  const ids = args.equipmentIds.slice(0, MAX_BULK)
  const batchId = makeBatchId()

  // Confirm the site is a real site-level orgUnit for this tenant.
  const siteRow = await ctx.db(async (tx) => {
    const [s] = await tx
      .select({ id: orgUnits.id, level: orgUnits.level, name: orgUnits.name })
      .from(orgUnits)
      .where(and(eq(orgUnits.id, args.siteOrgUnitId), isNull(orgUnits.deletedAt)))
      .limit(1)
    return s ?? null
  })
  if (!siteRow) return { ok: false, error: 'Site not found.' }
  if (siteRow.level !== 'site') {
    return { ok: false, error: 'Org-unit is not a site.' }
  }

  const result = await ctx.db(async (tx) => {
    const rows = await tx
      .select({ id: equipmentItems.id, deletedAt: equipmentItems.deletedAt })
      .from(equipmentItems)
      .where(inArray(equipmentItems.id, ids))
    const editable = rows.filter((r) => r.deletedAt === null).map((r) => r.id)
    const skipped = rows.length - editable.length
    if (editable.length === 0) return { updated: 0, skipped }
    await tx
      .update(equipmentItems)
      .set({ currentSiteOrgUnitId: args.siteOrgUnitId })
      .where(inArray(equipmentItems.id, editable))
    return { updated: editable.length, skipped, editable }
  })

  if ('editable' in result && result.editable) {
    for (const id of result.editable) {
      await recordAudit(ctx, {
        entityType: 'equipment',
        entityId: id,
        action: 'update',
        summary: `Bulk action: transferred to site "${siteRow.name}"`,
        after: { currentSiteOrgUnitId: args.siteOrgUnitId },
        metadata: { batchId },
      })
    }
    await recordAudit(ctx, {
      entityType: 'equipment',
      action: 'update',
      summary: `Bulk transferred ${result.editable.length} item${result.editable.length === 1 ? '' : 's'} to ${siteRow.name}`,
      metadata: {
        batchId,
        siteOrgUnitId: args.siteOrgUnitId,
        equipmentIds: result.editable,
        skipped: result.skipped,
      },
    })
  }

  revalidatePath('/equipment')
  return { ok: true, updated: result.updated, skipped: result.skipped }
}

export async function bulkAssignEquipmentToHolder(args: {
  equipmentIds: string[]
  personId: string
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  if (args.equipmentIds.length === 0) return { ok: false, error: 'No equipment selected.' }
  if (!args.personId) return { ok: false, error: 'Pick a holder.' }
  const ids = args.equipmentIds.slice(0, MAX_BULK)
  const batchId = makeBatchId()

  const person = await ctx.db(async (tx) => {
    const [p] = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
      })
      .from(people)
      .where(and(eq(people.id, args.personId), isNull(people.deletedAt)))
      .limit(1)
    return p ?? null
  })
  if (!person) return { ok: false, error: 'Holder not found.' }

  const result = await ctx.db(async (tx) => {
    const rows = await tx
      .select({ id: equipmentItems.id, deletedAt: equipmentItems.deletedAt })
      .from(equipmentItems)
      .where(inArray(equipmentItems.id, ids))
    const editable = rows.filter((r) => r.deletedAt === null).map((r) => r.id)
    const skipped = rows.length - editable.length
    if (editable.length === 0) return { updated: 0, skipped }
    await tx
      .update(equipmentItems)
      .set({
        currentHolderPersonId: args.personId,
        isAvailableForCheckout: false,
      })
      .where(inArray(equipmentItems.id, editable))
    return { updated: editable.length, skipped, editable }
  })

  if ('editable' in result && result.editable) {
    for (const id of result.editable) {
      await recordAudit(ctx, {
        entityType: 'equipment',
        entityId: id,
        action: 'update',
        summary: `Bulk action: assigned to ${person.firstName} ${person.lastName}`,
        after: { currentHolderPersonId: args.personId },
        metadata: { batchId },
      })
    }
    await recordAudit(ctx, {
      entityType: 'equipment',
      action: 'update',
      summary: `Bulk assigned ${result.editable.length} item${result.editable.length === 1 ? '' : 's'} to ${person.firstName} ${person.lastName}`,
      metadata: {
        batchId,
        personId: args.personId,
        equipmentIds: result.editable,
        skipped: result.skipped,
      },
    })
  }

  revalidatePath('/equipment')
  return { ok: true, updated: result.updated, skipped: result.skipped }
}

export type EquipmentStatus = 'in_service' | 'out_of_service' | 'in_repair' | 'lost' | 'retired'

const EQUIPMENT_STATUSES: EquipmentStatus[] = [
  'in_service',
  'out_of_service',
  'in_repair',
  'lost',
  'retired',
]

export async function bulkSetEquipmentStatus(args: {
  equipmentIds: string[]
  status: EquipmentStatus
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  if (args.equipmentIds.length === 0) return { ok: false, error: 'No equipment selected.' }
  if (!EQUIPMENT_STATUSES.includes(args.status)) {
    return { ok: false, error: 'Invalid status.' }
  }
  const ids = args.equipmentIds.slice(0, MAX_BULK)
  const batchId = makeBatchId()

  const result = await ctx.db(async (tx) => {
    const rows = await tx
      .select({ id: equipmentItems.id, deletedAt: equipmentItems.deletedAt })
      .from(equipmentItems)
      .where(inArray(equipmentItems.id, ids))
    const editable = rows.filter((r) => r.deletedAt === null).map((r) => r.id)
    const skipped = rows.length - editable.length
    if (editable.length === 0) return { updated: 0, skipped }
    await tx
      .update(equipmentItems)
      .set({
        status: args.status,
        // when status flips to non-service we definitely aren't available
        isAvailableForCheckout: args.status === 'in_service' ? undefined : false,
      })
      .where(inArray(equipmentItems.id, editable))
    return { updated: editable.length, skipped, editable }
  })

  if ('editable' in result && result.editable) {
    for (const id of result.editable) {
      await recordAudit(ctx, {
        entityType: 'equipment',
        entityId: id,
        action: 'update',
        summary: `Bulk action: set status ${args.status}`,
        after: { status: args.status },
        metadata: { batchId },
      })
    }
    await recordAudit(ctx, {
      entityType: 'equipment',
      action: 'update',
      summary: `Bulk set status to ${args.status} on ${result.editable.length} item${result.editable.length === 1 ? '' : 's'}`,
      metadata: {
        batchId,
        status: args.status,
        equipmentIds: result.editable,
        skipped: result.skipped,
      },
    })
  }

  revalidatePath('/equipment')
  return { ok: true, updated: result.updated, skipped: result.skipped }
}

export async function bulkExportEquipmentCsv(args: {
  equipmentIds: string[]
}): Promise<BulkCsvResult> {
  // Same gate as the /equipment/export.csv route: admin.data.export (with the
  // impersonation guard) plus the equipment read tier, scope-bounded below.
  const ctx = await requireExportContext()
  assertCan(ctx, 'equipment.read.site')
  if (args.equipmentIds.length === 0) return { ok: false, error: 'No equipment selected.' }
  const ids = args.equipmentIds.slice(0, MAX_BULK)
  const batchId = makeBatchId()

  const rows = await ctx.db(async (tx) => {
    const scope = await moduleScopeWhere(ctx, tx, {
      prefix: 'equipment',
      siteCol: equipmentItems.currentSiteOrgUnitId,
      personCol: equipmentItems.currentHolderPersonId,
    })
    return tx
      .select({
        item: equipmentItems,
        type: equipmentTypes,
        site: orgUnits,
        holder: people,
      })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
      .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
      .where(
        and(
          inArray(equipmentItems.id, ids),
          isNull(equipmentItems.deletedAt),
          ...(scope ? [scope] : []),
        ),
      )
      .orderBy(asc(equipmentItems.assetTag))
  })

  const headers = [
    'Asset tag',
    'Name',
    'Type',
    'Serial #',
    'Status',
    'Site',
    'Holder',
    'Purchase date',
  ]
  const csvLines = [csvRow(headers)]
  for (const { item, type, site, holder } of rows) {
    csvLines.push(
      csvRow([
        item.assetTag,
        item.name,
        type?.name ?? '',
        item.serialNumber ?? '',
        item.status,
        site?.name ?? '',
        holder ? `${holder.firstName} ${holder.lastName}` : '',
        item.purchaseDate ?? '',
      ]),
    )
  }
  const content = csvLines.join('\r\n') + '\r\n'
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const filename = `equipment-selected-${stamp}.csv`

  for (const { item } of rows) {
    await recordAudit(ctx, {
      entityType: 'equipment',
      entityId: item.id,
      action: 'export',
      summary: 'Bulk action: exported to CSV',
      metadata: { batchId },
    })
  }
  await recordAudit(ctx, {
    entityType: 'equipment',
    action: 'export',
    summary: `Bulk exported ${rows.length} equipment item${rows.length === 1 ? '' : 's'} to CSV`,
    metadata: { batchId, equipmentIds: rows.map((r) => r.item.id), format: 'csv' },
  })

  return { ok: true, filename, content }
}

// ---------- Lookups (used by bulk-bar dropdowns) ----------------------------

export async function listSiteOrgUnits(): Promise<{ id: string; name: string }[]> {
  const ctx = await requireRequestContext()
  return ctx.db(async (tx) =>
    tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(and(eq(orgUnits.level, 'site'), isNull(orgUnits.deletedAt)))
      .orderBy(asc(orgUnits.name)),
  )
}

export async function listPeopleForBulkHolder(): Promise<
  { id: string; name: string; employeeNo: string | null }[]
> {
  const ctx = await requireRequestContext()
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
        status: people.status,
      })
      .from(people)
      .where(and(eq(people.status, 'active'), isNull(people.deletedAt)))
      .orderBy(asc(people.lastName), asc(people.firstName))
      .limit(1000)
    return rows.map((r) => ({
      id: r.id,
      name: `${r.lastName}, ${r.firstName}`,
      employeeNo: r.employeeNo,
    }))
  })
}

// ---------- Check-in (sign in) ----------------------------------------------
// Shared by the /equipment/station page, the item-detail check-in drawer, and
// the dashboard "My equipment" widget's one-tap check-in. Returns the item to
// base: closes the open checkout, clears the holder, and flips the item back to
// available (when it's still in service). Condition defaults to "good" when the
// caller doesn't supply one (the dashboard one-tap case).
//
// Permission model: equipment.manage may close any checkout; everyone else may
// only check in equipment currently checked out to their own person record —
// the dashboard widget's entire audience.

const RETURN_CONDITIONS = ['good', 'fair', 'damaged', 'unusable'] as const
type ReturnCondition = (typeof RETURN_CONDITIONS)[number]

export async function checkInEquipment(formData: FormData) {
  const ctx = await requireRequestContext()
  const canManage = ctx.isSuperAdmin || can(ctx, 'equipment.manage')
  const id = String(formData.get('id') ?? '').trim()
  const rawCondition = String(formData.get('returnedCondition') ?? 'good').trim()
  const condition: ReturnCondition = (RETURN_CONDITIONS as readonly string[]).includes(rawCondition)
    ? (rawCondition as ReturnCondition)
    : 'good'
  const returnedNotes = String(formData.get('returnedNotes') ?? '').trim() || null
  if (!id) return

  const itemId = await ctx.db(async (tx) => {
    const [co] = await tx
      .select()
      .from(equipmentCheckouts)
      .where(eq(equipmentCheckouts.id, id))
      .limit(1)
    // Already returned (or unknown) — nothing to do; keeps the action idempotent.
    if (!co || co.returnedAt) return null
    if (!canManage) {
      // Self-service: only the person the item is checked out to may return it.
      const [me] = await tx
        .select({ id: people.id })
        .from(people)
        .where(eq(people.userId, ctx.userId))
        .limit(1)
      if (!me || co.holderPersonId !== me.id) {
        throw new Error('Forbidden: you can only check in equipment issued to you')
      }
    }
    const [item] = await tx
      .select({ status: equipmentItems.status })
      .from(equipmentItems)
      .where(eq(equipmentItems.id, co.equipmentItemId))
      .limit(1)
    await tx
      .update(equipmentCheckouts)
      .set({
        returnedAt: new Date(),
        returnedCondition: condition,
        returnedNotes,
        checkedInByTenantUserId: ctx.membership?.id,
      })
      .where(eq(equipmentCheckouts.id, id))
    await tx
      .update(equipmentItems)
      .set({
        currentHolderPersonId: null,
        isAvailableForCheckout: item?.status === 'in_service',
        lastSeenAt: new Date(),
      })
      .where(eq(equipmentItems.id, co.equipmentItemId))
    await tx.insert(equipmentLocationHistory).values({
      tenantId: ctx.tenantId,
      itemId: co.equipmentItemId,
      siteOrgUnitId: null,
      holderPersonId: null,
      recordedByTenantUserId: ctx.membership?.id,
      note: `Checked in (${condition})${returnedNotes ? ` — ${returnedNotes}` : ''}`,
    })
    return co.equipmentItemId
  })

  if (itemId) {
    await recordAudit(ctx, {
      entityType: 'equipment_checkout',
      entityId: id,
      action: 'update',
      summary: 'Checked equipment in',
      after: { condition, returnedNotes },
    })
  }
  revalidatePath('/equipment/station')
  revalidatePath('/dashboard')
  if (itemId) revalidatePath(`/equipment/${itemId}`)
}
