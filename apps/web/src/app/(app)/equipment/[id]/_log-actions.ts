'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { equipmentItems, equipmentLogEntries } from '@beaconhs/db/schema'
import { assertCan, type RequestContext } from '@beaconhs/tenant'
import type { Database } from '@beaconhs/db'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '../../../../lib/auth'
import { canSeeRecord } from '../../../../lib/visibility'
import { recordAuditInTransaction } from '../../../../lib/audit'
import {
  EQUIPMENT_LOG_KINDS,
  parseEquipmentLogAmount,
} from '../../../../lib/equipment/mutation-input'
import {
  optionalTextInput,
  optionalUuidInput,
  requiredDateInput,
  requiredTextInput,
  requireEnumInput,
  requireUuidInput,
} from '../../../../lib/mutation-input'

function logReturnUrl(formData: FormData, itemId: string) {
  const returnHref = optionalTextInput(formData.get('returnHref'), 'Return path', 4000)
  const returnUrl = new URL(returnHref ?? `/equipment/${itemId}?tab=log`, 'https://beacon.invalid')
  if (
    returnUrl.origin !== 'https://beacon.invalid' ||
    returnUrl.pathname !== `/equipment/${itemId}`
  )
    throw new Error('Return path is invalid.')
  returnUrl.searchParams.set('tab', 'log')
  returnUrl.searchParams.delete('drawer')
  returnUrl.searchParams.delete('entryId')
  return returnUrl
}

async function assertEquipmentVisible(ctx: RequestContext, tx: Database, itemId: string) {
  const [item] = await tx
    .select({
      id: equipmentItems.id,
      siteId: equipmentItems.currentSiteOrgUnitId,
      personId: equipmentItems.currentHolderPersonId,
    })
    .from(equipmentItems)
    .where(and(eq(equipmentItems.id, itemId), isNull(equipmentItems.deletedAt)))
    .limit(1)
  if (
    !item ||
    !(await canSeeRecord(ctx, tx, {
      prefix: 'equipment',
      siteId: item.siteId,
      personId: item.personId,
    }))
  )
    throw new Error('Equipment item was not found.')
}

async function lockedLogEntry(
  tx: Database,
  itemId: string,
  entryId: string,
  expectedUpdatedAt: string | null,
) {
  const [existing] = await tx
    .select()
    .from(equipmentLogEntries)
    .where(
      and(eq(equipmentLogEntries.id, entryId), eq(equipmentLogEntries.equipmentItemId, itemId)),
    )
    .limit(1)
    .for('update')
  if (!existing) throw new Error('Log entry was not found.')
  if (!expectedUpdatedAt || existing.updatedAt.toISOString() !== expectedUpdatedAt)
    throw new Error('This log entry changed. Reopen it before continuing.')
  return existing
}

export async function saveLogEntry(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const itemId = requireUuidInput(formData.get('itemId'), 'Equipment item')
  const entryId = optionalUuidInput(formData.get('entryId'), 'Log entry')
  const expectedUpdatedAt = optionalTextInput(
    formData.get('expectedUpdatedAt'),
    'Record version',
    40,
  )
  const returnUrl = logReturnUrl(formData, itemId)
  const entryDate = requiredDateInput(formData.get('entryDate'), 'Entry date')
  const kind = requireEnumInput(formData.get('kind') ?? 'note', EQUIPMENT_LOG_KINDS, 'Log kind')
  const amount = parseEquipmentLogAmount(kind, formData.get('amount'))
  const title = optionalTextInput(formData.get('title'), 'Title', 240)
  const details = requiredTextInput(formData.get('details'), 'Details', 10_000)

  await ctx.db(async (tx) => {
    await assertEquipmentVisible(ctx, tx, itemId)
    const values = { entryDate, kind, amount, title, details }
    if (entryId) {
      const existing = await lockedLogEntry(tx, itemId, entryId, expectedUpdatedAt)
      await tx.update(equipmentLogEntries).set(values).where(eq(equipmentLogEntries.id, entryId))
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'equipment_log_entry',
        entityId: entryId,
        action: 'update',
        summary: `Updated ${kind} log entry`,
        before: {
          entryDate: existing.entryDate,
          kind: existing.kind,
          amount: existing.amount,
          title: existing.title,
          details: existing.details.slice(0, 200),
        },
        after: { itemId, ...values, details: details.slice(0, 200) },
      })
    } else {
      const [row] = await tx
        .insert(equipmentLogEntries)
        .values({
          tenantId: ctx.tenantId,
          equipmentItemId: itemId,
          ...values,
          createdByTenantUserId: ctx.membership?.id,
        })
        .returning({ id: equipmentLogEntries.id })
      if (!row) throw new Error('Log entry was not saved.')
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'equipment_log_entry',
        entityId: row.id,
        action: 'create',
        summary: `Logged ${kind} entry`,
        after: { itemId, ...values, details: details.slice(0, 200) },
      })
    }
  })
  revalidatePath(`/equipment/${itemId}`)
  redirect(`${returnUrl.pathname}${returnUrl.search}`)
}

export async function deleteLogEntry(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const itemId = requireUuidInput(formData.get('itemId'), 'Equipment item')
  const entryId = requireUuidInput(formData.get('entryId'), 'Log entry')
  const expectedUpdatedAt = optionalTextInput(
    formData.get('expectedUpdatedAt'),
    'Record version',
    40,
  )
  const returnUrl = logReturnUrl(formData, itemId)
  await ctx.db(async (tx) => {
    await assertEquipmentVisible(ctx, tx, itemId)
    const existing = await lockedLogEntry(tx, itemId, entryId, expectedUpdatedAt)
    const removed = await tx
      .delete(equipmentLogEntries)
      .where(
        and(eq(equipmentLogEntries.id, entryId), eq(equipmentLogEntries.equipmentItemId, itemId)),
      )
      .returning({ id: equipmentLogEntries.id })
    if (removed.length !== 1) throw new Error('Log entry was not found.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment_log_entry',
      entityId: entryId,
      action: 'delete',
      summary: 'Deleted equipment log entry',
      before: existing,
      metadata: { itemId },
    })
  })
  revalidatePath(`/equipment/${itemId}`)
  redirect(`${returnUrl.pathname}${returnUrl.search}`)
}
