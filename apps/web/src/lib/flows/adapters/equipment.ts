import 'server-only'

// Equipment FlowSubjectAdapter — subject = an equipment WORK ORDER.
// Field-map keys mirror MODULE_FLOW_PROFILES.equipment.

import { eq } from 'drizzle-orm'
import {
  equipmentItems,
  equipmentWorkOrders,
  orgUnits,
  people,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import { fmtDateTime, personName, titleize } from '../format'
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
      const [head] = await ctx.db((tx) =>
        tx
          .select({
            w: equipmentWorkOrders,
            itemName: equipmentItems.name,
            siteName: orgUnits.name,
            assignedName: users.name,
            repFirst: people.firstName,
            repLast: people.lastName,
            repFormal: people.formalName,
          })
          .from(equipmentWorkOrders)
          .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentWorkOrders.itemId))
          .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
          .leftJoin(tenantUsers, eq(tenantUsers.id, equipmentWorkOrders.assignedToTenantUserId))
          .leftJoin(users, eq(users.id, tenantUsers.userId))
          .leftJoin(people, eq(people.id, equipmentWorkOrders.reportedByPersonId))
          .where(eq(equipmentWorkOrders.id, workOrderId))
          .limit(1),
      )
      if (!head) return {}
      const w = head.w
      return {
        reference: w.reference ?? null,
        summary: w.summary ?? null,
        description: w.description ?? '',
        action_taken: w.actionTaken ?? '',
        status: w.status ?? null,
        status_label: titleize(w.status),
        priority_label: titleize(w.priority),
        cost: w.cost ?? '',
        opened_at: fmtDateTime(w.openedAt),
        closed_at: fmtDateTime(w.closedAt),
        equipment_name: head.itemName ?? '',
        site_name: head.siteName ?? '',
        assigned_to_name: head.assignedName ?? '',
        reported_by_name: personName({
          firstName: head.repFirst,
          lastName: head.repLast,
          formalName: head.repFormal,
        }),
        // FK ids for conditions / recipient `field` targets.
        item_id: w.itemId ?? null,
        assigned_to_tenant_user_id: w.assignedToTenantUserId ?? null,
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
