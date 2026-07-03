// Shared work-order creation used by the full-page /equipment/work-orders/new
// form and the item-detail "New work order" drawer, so reference generation,
// audit, module flows (on_create automations), and revalidation stay in one
// place. Caller asserts the permission before delegating here.

import { revalidatePath } from 'next/cache'
import { sql } from 'drizzle-orm'
import { equipmentWorkOrders } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { runModuleFlows } from '@/lib/flows/run-module-flows'

export type CreateWorkOrderInput = {
  itemId: string
  summary: string
  description: string | null
  priority: 'low' | 'med' | 'high'
  assignedToTenantUserId: string | null
  reportedByPersonId: string | null
}

export async function createEquipmentWorkOrder(
  ctx: RequestContext,
  input: CreateWorkOrderInput,
): Promise<{ id: string; reference: string } | null> {
  const row = await ctx.db(async (tx) => {
    const year = new Date().getFullYear()
    // Count-based reference generation — a shared atomic generator replaces
    // this platform-wide; keeping the existing scheme in one place until then.
    const counts = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(equipmentWorkOrders)
      .where(sql`extract(year from ${equipmentWorkOrders.openedAt}) = ${year}`)
    const c = counts[0]?.c ?? 0
    const reference = `WO-${year}-${String(Number(c) + 1).padStart(4, '0')}`
    const [inserted] = await tx
      .insert(equipmentWorkOrders)
      .values({
        tenantId: ctx.tenantId,
        itemId: input.itemId,
        reference,
        summary: input.summary,
        description: input.description,
        priority: input.priority,
        status: 'open',
        reportedByPersonId: input.reportedByPersonId,
        assignedToTenantUserId: input.assignedToTenantUserId,
        openedByTenantUserId: ctx.membership?.id,
      })
      .returning({ id: equipmentWorkOrders.id, reference: equipmentWorkOrders.reference })
    return inserted ?? null
  })
  if (!row) return null

  await recordAudit(ctx, {
    entityType: 'equipment_work_order',
    entityId: row.id,
    action: 'create',
    summary: `Opened work order ${row.reference}: ${input.summary}`,
    after: {
      reference: row.reference,
      itemId: input.itemId,
      priority: input.priority,
      summary: input.summary,
      status: 'open',
    },
  })
  await runModuleFlows(ctx, { moduleKey: 'equipment', event: 'on_create', subjectId: row.id })
  revalidatePath('/equipment/work-orders')
  revalidatePath(`/equipment/${input.itemId}`)
  return row
}
