import 'server-only'

// Equipment FlowSubjectAdapter — subject = an equipment WORK ORDER.
// Field-map keys mirror MODULE_FLOW_PROFILES.equipment.

import { eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  equipmentCategories,
  equipmentItems,
  equipmentTypes,
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
      const holder = alias(people, 'wo_holder')
      const openedTU = alias(tenantUsers, 'wo_opened_tu')
      const openedU = alias(users, 'wo_opened_u')
      const [head] = await ctx.db((tx) =>
        tx
          .select({
            w: equipmentWorkOrders,
            itemName: equipmentItems.name,
            itemAssetTag: equipmentItems.assetTag,
            itemSerial: equipmentItems.serialNumber,
            itemDescription: equipmentItems.description,
            itemManufacturer: equipmentItems.manufacturer,
            itemModel: equipmentItems.model,
            itemLicensePlate: equipmentItems.licensePlate,
            itemStatus: equipmentItems.status,
            typeName: equipmentTypes.name,
            categoryName: equipmentCategories.name,
            siteName: orgUnits.name,
            assignedName: users.name,
            openedByName: openedU.name,
            repFirst: people.firstName,
            repLast: people.lastName,
            repFormal: people.formalName,
            holderFirst: holder.firstName,
            holderLast: holder.lastName,
            holderFormal: holder.formalName,
          })
          .from(equipmentWorkOrders)
          .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentWorkOrders.itemId))
          .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
          .leftJoin(equipmentCategories, eq(equipmentCategories.id, equipmentItems.categoryId))
          .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
          .leftJoin(tenantUsers, eq(tenantUsers.id, equipmentWorkOrders.assignedToTenantUserId))
          .leftJoin(users, eq(users.id, tenantUsers.userId))
          .leftJoin(openedTU, eq(openedTU.id, equipmentWorkOrders.openedByTenantUserId))
          .leftJoin(openedU, eq(openedU.id, openedTU.userId))
          .leftJoin(people, eq(people.id, equipmentWorkOrders.reportedByPersonId))
          .leftJoin(holder, eq(holder.id, equipmentItems.currentHolderPersonId))
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
        priority: w.priority ?? null,
        priority_label: titleize(w.priority),
        cost: w.cost ?? '',
        opened_at: fmtDateTime(w.openedAt),
        closed_at: fmtDateTime(w.closedAt),
        equipment_name: head.itemName ?? '',
        // Linked-asset details — the bespoke work-order PDF's Equipment Item
        // panel (plus the register attributes the record page shows).
        asset_tag: head.itemAssetTag ?? '',
        serial_number: head.itemSerial ?? '',
        equipment_description: head.itemDescription ?? '',
        equipment_type_name: head.typeName ?? '',
        equipment_category_name: head.categoryName ?? '',
        equipment_status: head.itemStatus ?? null,
        equipment_status_label: titleize(head.itemStatus),
        manufacturer: head.itemManufacturer ?? '',
        model: head.itemModel ?? '',
        license_plate: head.itemLicensePlate ?? '',
        holder_name: personName({
          firstName: head.holderFirst,
          lastName: head.holderLast,
          formalName: head.holderFormal,
        }),
        site_name: head.siteName ?? '',
        assigned_to_name: head.assignedName ?? '',
        opened_by_name: head.openedByName ?? '',
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
