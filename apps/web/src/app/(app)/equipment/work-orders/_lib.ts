// Shared work-order creation used by the full-page /equipment/work-orders/new
// form and the item-detail "New work order" drawer, so reference generation,
// audit, module flows (on_create automations), and revalidation stay in one
// place. Caller asserts the permission before delegating here.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { equipmentItems, equipmentWorkOrders, people, tenantUsers } from '@beaconhs/db/schema'
import { recordModuleFlowEvent } from '@beaconhs/events'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { nextReference } from '@/lib/reference'
import { moduleScopeWhere } from '@/lib/visibility'
import {
  optionalTextInput,
  optionalUuidInput,
  requiredTextInput,
  requireEnumInput,
  requireUuidInput,
} from '@/lib/mutation-input'

const WORK_ORDER_PRIORITIES = ['low', 'med', 'high'] as const

type CreateWorkOrderInput = {
  itemId: string
  summary: string
  description: string | null
  priority: 'low' | 'med' | 'high'
  assignedToTenantUserId: string | null
  reportedByPersonId: string | null
}

export async function assertEquipmentWorkOrderReferences(
  ctx: RequestContext,
  tx: Database,
  input: Pick<CreateWorkOrderInput, 'itemId' | 'assignedToTenantUserId' | 'reportedByPersonId'>,
): Promise<void> {
  const scope = await moduleScopeWhere(ctx, tx, {
    prefix: 'equipment',
    siteCol: equipmentItems.currentSiteOrgUnitId,
    personCol: equipmentItems.currentHolderPersonId,
  })
  const [item] = await tx
    .select({ id: equipmentItems.id })
    .from(equipmentItems)
    .where(and(eq(equipmentItems.id, input.itemId), isNull(equipmentItems.deletedAt), scope))
    .limit(1)
    .for('share')
  if (!item) throw new Error('Equipment item was not found.')

  if (input.assignedToTenantUserId) {
    const [assignee] = await tx
      .select({ id: tenantUsers.id })
      .from(tenantUsers)
      .where(
        and(eq(tenantUsers.id, input.assignedToTenantUserId), eq(tenantUsers.status, 'active')),
      )
      .limit(1)
      .for('share')
    if (!assignee) throw new Error('Select an active assignee.')
  }

  if (input.reportedByPersonId) {
    const [reporter] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.id, input.reportedByPersonId),
          eq(people.status, 'active'),
          isNull(people.deletedAt),
        ),
      )
      .limit(1)
      .for('share')
    if (!reporter) throw new Error('Select an active reporter.')
  }
}

export async function createEquipmentWorkOrder(
  ctx: RequestContext,
  input: CreateWorkOrderInput,
): Promise<{ id: string; reference: string } | null> {
  const parsed = {
    itemId: requireUuidInput(input.itemId, 'Equipment item'),
    summary: requiredTextInput(input.summary, 'Summary', 500),
    description: optionalTextInput(input.description, 'Description', 10_000),
    priority: requireEnumInput(input.priority, WORK_ORDER_PRIORITIES, 'Priority'),
    assignedToTenantUserId: optionalUuidInput(input.assignedToTenantUserId, 'Assignee'),
    reportedByPersonId: optionalUuidInput(input.reportedByPersonId, 'Reporter'),
  }
  const row = await ctx.db(async (tx) => {
    await assertEquipmentWorkOrderReferences(ctx, tx, parsed)

    const reference = await nextReference(tx, ctx.tenantId, 'work_order')
    const [inserted] = await tx
      .insert(equipmentWorkOrders)
      .values({
        tenantId: ctx.tenantId,
        itemId: parsed.itemId,
        reference,
        summary: parsed.summary,
        description: parsed.description,
        priority: parsed.priority,
        status: 'open',
        reportedByPersonId: parsed.reportedByPersonId,
        assignedToTenantUserId: parsed.assignedToTenantUserId,
        openedByTenantUserId: ctx.membership?.id,
      })
      .returning({ id: equipmentWorkOrders.id, reference: equipmentWorkOrders.reference })
    if (inserted) {
      await recordModuleFlowEvent(tx, ctx, {
        subjectId: inserted.id,
        moduleKey: 'equipment',
        event: 'on_create',
        occurrenceKey: inserted.id,
      })
    }
    return inserted ?? null
  })
  if (!row) return null

  await recordAudit(ctx, {
    entityType: 'equipment_work_order',
    entityId: row.id,
    action: 'create',
    summary: `Opened work order ${row.reference}: ${parsed.summary}`,
    after: {
      reference: row.reference,
      itemId: parsed.itemId,
      priority: parsed.priority,
      summary: parsed.summary,
      status: 'open',
    },
  })
  revalidatePath('/equipment/work-orders')
  revalidatePath(`/equipment/${parsed.itemId}`)
  return row
}
