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
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  equipmentCheckouts,
  equipmentItems,
  equipmentLocationHistory,
  equipmentStationSettings,
  equipmentTypes,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { assertCan, can } from '@beaconhs/tenant'
import { recordModuleFlowEvent } from '@beaconhs/events'
import { requireExportContext, requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { recordAudit } from '@/lib/audit'
import { materializeEquipmentTypeEvidence } from '@/lib/compliance-type-evidence'
import { csvRow } from '@/lib/csv'
import { isBulkActionId, newBulkActionBatchId, parseBulkActionIds } from '@/lib/bulk-actions'
import {
  lockEquipmentCustodyRows,
  lockOpenEquipmentCheckout,
  openCheckoutConflictMessage,
  openEquipmentCheckoutItemIds,
  refreshEquipmentAvailability,
} from '@/lib/equipment-custody'

type BulkActionResult =
  { ok: true; updated: number; skipped: number } | { ok: false; error: string }

type BulkCsvResult = { ok: true; filename: string; content: string } | { ok: false; error: string }

function revalidateEquipmentCustody(): void {
  revalidatePath('/equipment')
  revalidatePath('/equipment/station')
  revalidatePath('/dashboard')
}

export async function bulkTransferEquipmentToSite(args: {
  equipmentIds: string[]
  siteOrgUnitId: string
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const parsedIds = parseBulkActionIds(args?.equipmentIds, {
    singular: 'equipment item',
    plural: 'equipment items',
  })
  if (!parsedIds.ok) return parsedIds
  if (!isBulkActionId(args?.siteOrgUnitId)) return { ok: false, error: 'Pick a site.' }
  const ids = parsedIds.ids
  const batchId = newBulkActionBatchId()

  const result = await ctx.db(async (tx) => {
    // Validate the destination and lock every target in the same transaction;
    // otherwise either row could change between validation and mutation.
    const [s] = await tx
      .select({ id: orgUnits.id, level: orgUnits.level, name: orgUnits.name })
      .from(orgUnits)
      .where(and(eq(orgUnits.id, args.siteOrgUnitId), isNull(orgUnits.deletedAt)))
      .limit(1)
    if (!s) return { ok: false as const, error: 'Site not found.' }
    if (s.level !== 'site') return { ok: false as const, error: 'Org-unit is not a site.' }

    const rows = await lockEquipmentCustodyRows(tx, ids)
    const editableRows = rows.filter(({ deletedAt }) => deletedAt === null)
    const editable = editableRows.map(({ id }) => id)
    const skipped = ids.length - editable.length
    if (editable.length === 0) {
      return { ok: true as const, updated: 0, skipped, editable, site: s }
    }
    const openIds = await openEquipmentCheckoutItemIds(tx, editable)
    const conflicts = editableRows.filter(({ id }) => openIds.has(id))
    if (conflicts.length > 0) {
      return { ok: false as const, error: openCheckoutConflictMessage(conflicts) }
    }
    const now = new Date()
    await tx
      .update(equipmentItems)
      .set({
        currentSiteOrgUnitId: args.siteOrgUnitId,
        lastSeenSiteOrgUnitId: args.siteOrgUnitId,
        lastSeenHolderPersonId: sql`${equipmentItems.currentHolderPersonId}`,
        lastSeenAt: now,
        isMissing: false,
      })
      .where(inArray(equipmentItems.id, editable))
    const foundIds = editableRows.filter(({ isMissing }) => isMissing).map(({ id }) => id)
    if (foundIds.length > 0) {
      await tx
        .update(equipmentItems)
        .set({ missingFoundAt: now })
        .where(inArray(equipmentItems.id, foundIds))
    }
    await tx.insert(equipmentLocationHistory).values(
      editableRows.map((row) => ({
        tenantId: ctx.tenantId,
        itemId: row.id,
        siteOrgUnitId: args.siteOrgUnitId,
        holderPersonId: row.currentHolderPersonId,
        recordedByTenantUserId: ctx.membership?.id,
        recordedAt: now,
        note: `Bulk transfer to ${s.name}`,
      })),
    )
    await refreshEquipmentAvailability(tx, editable)
    return {
      ok: true as const,
      updated: editable.length,
      skipped,
      editable,
      site: s,
    }
  })
  if (!result.ok) return result

  if (result.editable.length > 0) {
    for (const id of result.editable) {
      await recordAudit(ctx, {
        entityType: 'equipment',
        entityId: id,
        action: 'update',
        summary: `Bulk action: transferred to site "${result.site.name}"`,
        after: { currentSiteOrgUnitId: args.siteOrgUnitId },
        metadata: { batchId },
      })
    }
    await recordAudit(ctx, {
      entityType: 'equipment',
      action: 'update',
      summary: `Bulk transferred ${result.editable.length} item${result.editable.length === 1 ? '' : 's'} to ${result.site.name}`,
      metadata: {
        batchId,
        siteOrgUnitId: args.siteOrgUnitId,
        equipmentIds: result.editable,
        skipped: result.skipped,
      },
    })
  }

  revalidateEquipmentCustody()
  return { ok: true, updated: result.updated, skipped: result.skipped }
}

export async function bulkAssignEquipmentToHolder(args: {
  equipmentIds: string[]
  personId: string
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const parsedIds = parseBulkActionIds(args?.equipmentIds, {
    singular: 'equipment item',
    plural: 'equipment items',
  })
  if (!parsedIds.ok) return parsedIds
  if (!isBulkActionId(args?.personId)) return { ok: false, error: 'Pick a holder.' }
  const ids = parsedIds.ids
  const batchId = newBulkActionBatchId()

  const result = await ctx.db(async (tx) => {
    const [p] = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
      })
      .from(people)
      .where(
        and(eq(people.id, args.personId), eq(people.status, 'active'), isNull(people.deletedAt)),
      )
      .limit(1)
    if (!p) return { ok: false as const, error: 'Active holder not found.' }

    const rows = await lockEquipmentCustodyRows(tx, ids)
    const editableRows = rows.filter(({ deletedAt }) => deletedAt === null)
    const editable = editableRows.map(({ id }) => id)
    const skipped = ids.length - editable.length
    if (editable.length === 0) {
      return { ok: true as const, updated: 0, skipped, editable, person: p }
    }
    const openIds = await openEquipmentCheckoutItemIds(tx, editable)
    const conflicts = editableRows.filter(({ id }) => openIds.has(id))
    if (conflicts.length > 0) {
      return { ok: false as const, error: openCheckoutConflictMessage(conflicts) }
    }
    const now = new Date()
    await tx
      .update(equipmentItems)
      .set({
        currentHolderPersonId: args.personId,
        lastSeenSiteOrgUnitId: sql`${equipmentItems.currentSiteOrgUnitId}`,
        lastSeenHolderPersonId: args.personId,
        lastSeenAt: now,
        isMissing: false,
        isAvailableForCheckout: false,
      })
      .where(inArray(equipmentItems.id, editable))
    const foundIds = editableRows.filter(({ isMissing }) => isMissing).map(({ id }) => id)
    if (foundIds.length > 0) {
      await tx
        .update(equipmentItems)
        .set({ missingFoundAt: now })
        .where(inArray(equipmentItems.id, foundIds))
    }
    await tx.insert(equipmentLocationHistory).values(
      editableRows.map((row) => ({
        tenantId: ctx.tenantId,
        itemId: row.id,
        siteOrgUnitId: row.currentSiteOrgUnitId,
        holderPersonId: args.personId,
        recordedByTenantUserId: ctx.membership?.id,
        recordedAt: now,
        note: `Bulk assignment to ${p.firstName} ${p.lastName}`,
      })),
    )
    return {
      ok: true as const,
      updated: editable.length,
      skipped,
      editable,
      person: p,
    }
  })
  if (!result.ok) return result

  if (result.editable.length > 0) {
    for (const id of result.editable) {
      await recordAudit(ctx, {
        entityType: 'equipment',
        entityId: id,
        action: 'update',
        summary: `Bulk action: assigned to ${result.person.firstName} ${result.person.lastName}`,
        after: { currentHolderPersonId: args.personId },
        metadata: { batchId },
      })
    }
    await recordAudit(ctx, {
      entityType: 'equipment',
      action: 'update',
      summary: `Bulk assigned ${result.editable.length} item${result.editable.length === 1 ? '' : 's'} to ${result.person.firstName} ${result.person.lastName}`,
      metadata: {
        batchId,
        personId: args.personId,
        equipmentIds: result.editable,
        skipped: result.skipped,
      },
    })
  }

  revalidateEquipmentCustody()
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
  const parsedIds = parseBulkActionIds(args?.equipmentIds, {
    singular: 'equipment item',
    plural: 'equipment items',
  })
  if (!parsedIds.ok) return parsedIds
  const status = args?.status
  if (!status || !EQUIPMENT_STATUSES.includes(status)) {
    return { ok: false, error: 'Invalid status.' }
  }
  const ids = parsedIds.ids
  const batchId = newBulkActionBatchId()

  const result = await ctx.db(async (tx) => {
    const rows = await lockEquipmentCustodyRows(tx, ids)
    const editableRows = rows.filter((r) => r.deletedAt === null)
    const editable = editableRows.map((r) => r.id)
    const skipped = ids.length - editable.length
    if (editable.length === 0) return { updated: 0, skipped }
    await tx.update(equipmentItems).set({ status }).where(inArray(equipmentItems.id, editable))
    await refreshEquipmentAvailability(tx, editable)
    for (const row of editableRows) {
      if (row.status === status) continue
      await recordModuleFlowEvent(tx, ctx, {
        subjectId: row.id,
        moduleKey: 'equipment-assets',
        event: 'status_change',
        toStatus: status,
        occurrenceKey: `${batchId}:${row.id}`,
      })
    }
    await materializeEquipmentTypeEvidence(
      tx,
      ctx.tenantId,
      editableRows.map((row) => row.typeId),
    )
    return { updated: editable.length, skipped, editable }
  })

  if ('editable' in result && result.editable) {
    for (const id of result.editable) {
      await recordAudit(ctx, {
        entityType: 'equipment',
        entityId: id,
        action: 'update',
        summary: `Bulk action: set status ${status}`,
        after: { status },
        metadata: { batchId },
      })
    }
    await recordAudit(ctx, {
      entityType: 'equipment',
      action: 'update',
      summary: `Bulk set status to ${status} on ${result.editable.length} item${result.editable.length === 1 ? '' : 's'}`,
      metadata: {
        batchId,
        status,
        equipmentIds: result.editable,
        skipped: result.skipped,
      },
    })
  }

  revalidateEquipmentCustody()
  return { ok: true, updated: result.updated, skipped: result.skipped }
}

export async function bulkExportEquipmentCsv(args: {
  equipmentIds: string[]
}): Promise<BulkCsvResult> {
  // Same gate as the /equipment/export.csv route: admin.data.export (with the
  // impersonation guard) plus the equipment read tier, scope-bounded below.
  const ctx = await requireExportContext()
  assertCan(ctx, 'equipment.read.site')
  const parsedIds = parseBulkActionIds(args?.equipmentIds, {
    singular: 'equipment item',
    plural: 'equipment items',
  })
  if (!parsedIds.ok) return parsedIds
  const ids = parsedIds.ids
  const batchId = newBulkActionBatchId()

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
  if (!(RETURN_CONDITIONS as readonly string[]).includes(rawCondition)) {
    throw new Error('Invalid return condition')
  }
  const condition = rawCondition as ReturnCondition
  const returnedNotes = String(formData.get('returnedNotes') ?? '').trim() || null
  if (!id) return
  if (returnedNotes && returnedNotes.length > 2_000) {
    throw new Error('Return notes must be 2,000 characters or less')
  }

  const checkedIn = await ctx.db(async (tx) => {
    // Read only enough to discover the item, then acquire locks in the global
    // equipment-row -> checkout-row order used by every custody writer.
    const [candidate] = await tx
      .select({ itemId: equipmentCheckouts.equipmentItemId })
      .from(equipmentCheckouts)
      .where(eq(equipmentCheckouts.id, id))
      .limit(1)
    if (!candidate) return null
    const [item] = await lockEquipmentCustodyRows(tx, [candidate.itemId])
    if (!item || item.deletedAt) return null
    const co = await lockOpenEquipmentCheckout(tx, id)
    // Already returned (or unknown) — nothing to do; keeps the action idempotent.
    if (!co || co.equipmentItemId !== item.id) return null
    if (!canManage) {
      // RequestContext owns the canonical login -> person mapping.
      if (!ctx.personId || co.holderPersonId !== ctx.personId) {
        throw new Error('Forbidden: you can only check in equipment issued to you')
      }
    }
    const [settings] = await tx
      .select({ homeOrgUnitId: equipmentStationSettings.defaultCheckInOrgUnitId })
      .from(equipmentStationSettings)
      .where(eq(equipmentStationSettings.tenantId, ctx.tenantId))
      .limit(1)
    const returnSiteOrgUnitId = settings?.homeOrgUnitId ?? null
    if (!returnSiteOrgUnitId) {
      throw new Error('Set a default check-in location before checking equipment in')
    }
    const [home] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(and(eq(orgUnits.id, returnSiteOrgUnitId), isNull(orgUnits.deletedAt)))
      .limit(1)
    if (!home) throw new Error('The configured default check-in location is unavailable')
    const now = new Date()
    await tx
      .update(equipmentCheckouts)
      .set({
        returnedAt: now,
        returnedCondition: condition,
        returnedNotes,
        checkedInByTenantUserId: ctx.membership?.id,
      })
      .where(eq(equipmentCheckouts.id, id))
    await tx
      .update(equipmentItems)
      .set({
        currentHolderPersonId: null,
        currentSiteOrgUnitId: returnSiteOrgUnitId,
        lastSeenSiteOrgUnitId: returnSiteOrgUnitId,
        lastSeenAt: now,
        isMissing: false,
        missingFoundAt: item.isMissing ? now : undefined,
      })
      .where(eq(equipmentItems.id, co.equipmentItemId))
    await refreshEquipmentAvailability(tx, [co.equipmentItemId])
    await tx.insert(equipmentLocationHistory).values({
      tenantId: ctx.tenantId,
      itemId: co.equipmentItemId,
      siteOrgUnitId: returnSiteOrgUnitId,
      holderPersonId: null,
      recordedByTenantUserId: ctx.membership?.id,
      recordedAt: now,
      note: `Checked in (${condition})${returnedNotes ? ` — ${returnedNotes}` : ''}`,
    })
    return { itemId: co.equipmentItemId, returnSiteOrgUnitId }
  })

  if (checkedIn) {
    await recordAudit(ctx, {
      entityType: 'equipment_checkout',
      entityId: id,
      action: 'update',
      summary: 'Checked equipment in',
      after: { condition, returnedNotes, returnSiteOrgUnitId: checkedIn.returnSiteOrgUnitId },
    })
  }
  revalidateEquipmentCustody()
  if (checkedIn) revalidatePath(`/equipment/${checkedIn.itemId}`)
}
