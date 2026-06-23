import 'server-only'

// Equipment FlowSubjectAdapter — subject = an equipment WORK ORDER.
// Field-map keys mirror MODULE_FLOW_PROFILES.equipment.

import { eq } from 'drizzle-orm'
import { equipmentWorkOrders, tenantUsers, users } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import type { FlowSubjectAdapter } from '../types'

export function createEquipmentFlowAdapter(
  ctx: RequestContext,
  workOrderId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'equipment',
    subjectId: workOrderId,
    notifyCategory: 'equipment',
    auditEntityType: 'equipment_work_order',
    deepLink: () => `/equipment/work-orders/${workOrderId}`,
    pdfJob: (values) =>
      buildRecordSummaryPdfJob({
        tenantId: ctx.tenantId,
        subjectId: workOrderId,
        entityType: 'equipment_work_order',
        heading: 'Equipment work order',
        reference: values.reference,
        subtitle: values.summary,
        values,
      }),

    async loadValues() {
      const [w] = await ctx.db((tx) =>
        tx
          .select({
            reference: equipmentWorkOrders.reference,
            summary: equipmentWorkOrders.summary,
            status: equipmentWorkOrders.status,
            openedAt: equipmentWorkOrders.openedAt,
            closedAt: equipmentWorkOrders.closedAt,
            itemId: equipmentWorkOrders.itemId,
            assignedToTenantUserId: equipmentWorkOrders.assignedToTenantUserId,
          })
          .from(equipmentWorkOrders)
          .where(eq(equipmentWorkOrders.id, workOrderId))
          .limit(1),
      )
      return {
        reference: w?.reference ?? null,
        summary: w?.summary ?? null,
        status: w?.status ?? null,
        opened_at: w?.openedAt ? w.openedAt.toISOString() : null,
        closed_at: w?.closedAt ? w.closedAt.toISOString() : null,
        item_id: w?.itemId ?? null,
        assigned_to_tenant_user_id: w?.assignedToTenantUserId ?? null,
      }
    },

    async resolveSubmitter() {
      const [w] = await ctx.db((tx) =>
        tx
          .select({
            assigned: equipmentWorkOrders.assignedToTenantUserId,
            opened: equipmentWorkOrders.openedByTenantUserId,
          })
          .from(equipmentWorkOrders)
          .where(eq(equipmentWorkOrders.id, workOrderId))
          .limit(1),
      )
      const tuid = w?.assigned ?? w?.opened ?? null
      let email: string | null = null
      let userId: string | null = null
      if (tuid) {
        const [u] = await ctx.db((tx) =>
          tx
            .select({ email: users.email, userId: users.id })
            .from(tenantUsers)
            .innerJoin(users, eq(users.id, tenantUsers.userId))
            .where(eq(tenantUsers.id, tuid))
            .limit(1),
        )
        email = u?.email ?? null
        userId = u?.userId ?? null
      }
      return { tenantUserId: tuid, email, userId }
    },
  }
}
