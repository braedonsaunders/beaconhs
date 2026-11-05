'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { activePeopleWhere } from '@beaconhs/db'
import {
  equipmentCheckouts,
  equipmentItems,
  equipmentLocationHistory,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRequestContext } from '../../../../lib/auth'
import { recordAuditInTransaction } from '../../../../lib/audit'
import {
  optionalDateInput,
  optionalTextInput,
  optionalUuidInput,
  requireUuidInput,
} from '../../../../lib/mutation-input'
import {
  lockEquipmentCustodyRows,
  openEquipmentCheckoutItemIds,
  refreshEquipmentAvailability,
} from '../../../../lib/equipment-custody'

export async function transferLocation(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const id = requireUuidInput(formData.get('id'), 'Equipment item')
  const siteOrgUnitId = optionalUuidInput(formData.get('siteOrgUnitId'), 'Location')
  const holderPersonId = optionalUuidInput(formData.get('holderPersonId'), 'Holder')
  const note = optionalTextInput(formData.get('note'), 'Transfer note', 2_000)

  await ctx.db(async (tx) => {
    const [item] = await lockEquipmentCustodyRows(tx, [id])
    if (!item || item.deletedAt) throw new Error('Equipment item not found')
    if (siteOrgUnitId && siteOrgUnitId !== item.currentSiteOrgUnitId) {
      const [site] = await tx
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(and(eq(orgUnits.id, siteOrgUnitId), isNull(orgUnits.deletedAt)))
        .limit(1)
      if (!site) throw new Error('Select an active location')
    }
    if (holderPersonId && holderPersonId !== item.currentHolderPersonId) {
      const [person] = await tx
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.id, holderPersonId), activePeopleWhere()))
        .limit(1)
      if (!person) throw new Error('Select an active holder')
    }
    const openIds = await openEquipmentCheckoutItemIds(tx, [id])
    if (openIds.has(id)) {
      throw new Error('Check this item in before recording a direct custody transfer')
    }
    const now = new Date()
    await tx
      .update(equipmentItems)
      .set({
        currentSiteOrgUnitId: siteOrgUnitId,
        currentHolderPersonId: holderPersonId,
        lastSeenSiteOrgUnitId: siteOrgUnitId,
        lastSeenHolderPersonId: holderPersonId,
        lastSeenAt: now,
        isMissing: false,
        missingFoundAt: item.isMissing ? now : undefined,
      })
      .where(eq(equipmentItems.id, id))
    await tx.insert(equipmentLocationHistory).values({
      tenantId: ctx.tenantId,
      itemId: id,
      siteOrgUnitId,
      holderPersonId,
      recordedByTenantUserId: ctx.membership?.id,
      recordedAt: now,
      note,
    })
    await refreshEquipmentAvailability(tx, [id])
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment',
      entityId: id,
      action: 'update',
      summary: 'Equipment transferred',
      before: {
        siteOrgUnitId: item.currentSiteOrgUnitId,
        holderPersonId: item.currentHolderPersonId,
      },
      after: { siteOrgUnitId, holderPersonId, note },
    })
  })
  revalidatePath(`/equipment/${id}`)
  revalidatePath('/equipment')
  revalidatePath('/equipment/station')
  revalidatePath('/dashboard')
  redirect(`/equipment/${id}?tab=location&locationView=custody`)
}

export async function checkOutFromItem(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.custody')
  const itemId = requireUuidInput(formData.get('itemId'), 'Equipment item')
  const holderPersonId = optionalUuidInput(formData.get('holderPersonId'), 'Holder')
  const destinationOrgUnitId = optionalUuidInput(
    formData.get('destinationOrgUnitId'),
    'Check-out destination',
  )
  if (!holderPersonId && !destinationOrgUnitId) {
    throw new Error('Select a holder or a check-out destination')
  }
  const expectedReturnOn = optionalDateInput(
    formData.get('expectedReturnOn'),
    'Expected return date',
  )
  const notes = optionalTextInput(formData.get('notes'), 'Check-out notes', 2_000)

  await ctx.db(async (tx) => {
    // Serialize every checkout decision on the equipment row. The database
    // partial-unique index is the final backstop; this lock gives the operator
    // a useful domain error instead of a constraint error under normal races.
    const [item] = await lockEquipmentCustodyRows(tx, [itemId])
    if (!item || item.deletedAt) throw new Error('Equipment item not found')
    if (item.status !== 'in_service') {
      throw new Error(`Cannot check out: item is ${item.status.replace(/_/g, ' ')}`)
    }
    if (item.isMissing) throw new Error('Report this item found before checking it out')
    if (item.isCheckedOut) throw new Error('Check this item in before checking it out again')
    if (destinationOrgUnitId) {
      const [destination] = await tx
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(and(eq(orgUnits.id, destinationOrgUnitId), isNull(orgUnits.deletedAt)))
        .limit(1)
      if (!destination) throw new Error('Select an active check-out destination')
    }
    if (holderPersonId) {
      const [person] = await tx
        .select({ id: people.id })
        .from(people)
        .where(and(eq(people.id, holderPersonId), activePeopleWhere()))
        .limit(1)
      if (!person) throw new Error('Select an active holder')
    }

    const now = new Date()
    const [row] = await tx
      .insert(equipmentCheckouts)
      .values({
        tenantId: ctx.tenantId,
        equipmentItemId: itemId,
        holderPersonId,
        destinationOrgUnitId,
        expectedReturnOn,
        notes,
        checkedOutByTenantUserId: ctx.membership?.id,
      })
      .returning({ id: equipmentCheckouts.id })
    await tx
      .update(equipmentItems)
      .set({
        currentHolderPersonId: holderPersonId,
        currentSiteOrgUnitId: destinationOrgUnitId,
        lastSeenHolderPersonId: holderPersonId,
        lastSeenSiteOrgUnitId: destinationOrgUnitId,
        lastSeenAt: now,
        isAvailableForCheckout: false,
      })
      .where(eq(equipmentItems.id, itemId))
    await tx.insert(equipmentLocationHistory).values({
      tenantId: ctx.tenantId,
      itemId,
      siteOrgUnitId: destinationOrgUnitId,
      holderPersonId,
      recordedByTenantUserId: ctx.membership?.id,
      recordedAt: now,
      movementKind: 'check_out',
      note: notes,
    })
    if (!row) throw new Error('Check-out could not be created')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment_checkout',
      entityId: row.id,
      action: 'create',
      summary: 'Checked equipment out',
      after: { itemId, holderPersonId, destinationOrgUnitId, expectedReturnOn },
    })
  })
  revalidatePath(`/equipment/${itemId}`)
  revalidatePath('/equipment')
  revalidatePath('/equipment/station')
  revalidatePath('/dashboard')
  redirect(`/equipment/${itemId}?tab=location&locationView=custody`)
}
