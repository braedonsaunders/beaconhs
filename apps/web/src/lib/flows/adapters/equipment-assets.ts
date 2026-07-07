import 'server-only'

// Equipment ASSET FlowSubjectAdapter (the register itself — distinct from the
// 'equipment' subject, which is work orders). Fires when an asset is
// registered (its draft is committed) or its status changes. Field keys mirror
// MODULE_FLOW_PROFILES['equipment-assets'].
//
// equipment_items has no created-by column, so `submitter` resolves to the
// asset's current holder's linked login (if any) — the closest owning person.

import { eq } from 'drizzle-orm'
import {
  equipmentCategories,
  equipmentItems,
  equipmentTypes,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { buildRecordSummaryPdfJob } from '../pdf-summary'
import { personName, titleize } from '../format'
import type { FlowSubjectAdapter } from '../types'

export function createEquipmentAssetFlowAdapter(
  ctx: RequestContext,
  itemId: string,
): FlowSubjectAdapter {
  return {
    subjectType: 'module',
    subjectKey: 'equipment-assets',
    subjectId: itemId,
    notifyCategory: 'equipment',
    auditEntityType: 'equipment',
    deepLink: () => `/equipment/${itemId}`,
    pdfJob: (values) =>
      buildRecordSummaryPdfJob({
        tenantId: ctx.tenantId,
        subjectId: itemId,
        entityType: 'equipment',
        heading: 'Equipment asset',
        reference: values.asset_tag,
        subtitle: values.name,
        values,
      }),

    async loadValues() {
      const [e] = await ctx.db((tx) =>
        tx
          .select({
            row: equipmentItems,
            categoryName: equipmentCategories.name,
            typeName: equipmentTypes.name,
            siteName: orgUnits.name,
            holderFirst: people.firstName,
            holderLast: people.lastName,
            holderFormal: people.formalName,
          })
          .from(equipmentItems)
          .leftJoin(equipmentCategories, eq(equipmentCategories.id, equipmentItems.categoryId))
          .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
          .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
          .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
          .where(eq(equipmentItems.id, itemId))
          .limit(1),
      )
      if (!e) return {}
      const r = e.row
      return {
        reference: r.assetTag,
        asset_tag: r.assetTag,
        name: r.name,
        description: r.description ?? '',
        serial_number: r.serialNumber ?? '',
        manufacturer: r.manufacturer ?? '',
        model: r.model ?? '',
        vin: r.vin ?? '',
        license_plate: r.licensePlate ?? '',
        category_name: e.categoryName ?? '',
        type_name: e.typeName ?? '',
        ownership: titleize(r.ownership),
        status: r.status,
        status_label: titleize(r.status),
        site_name: e.siteName ?? '',
        holder_name: personName({
          firstName: e.holderFirst,
          lastName: e.holderLast,
          formalName: e.holderFormal,
        }),
        // FK ids for conditions / recipient `field` targets.
        holder_person_id: r.currentHolderPersonId ?? null,
        site_org_unit_id: r.currentSiteOrgUnitId ?? null,
      }
    },

    async resolveSubmitter() {
      const [e] = await ctx.db((tx) =>
        tx
          .select({ holderPersonId: equipmentItems.currentHolderPersonId })
          .from(equipmentItems)
          .where(eq(equipmentItems.id, itemId))
          .limit(1),
      )
      if (!e?.holderPersonId) return { tenantUserId: null, email: null, userId: null }
      const [p] = await ctx.db((tx) =>
        tx
          .select({ email: people.email, userId: people.userId })
          .from(people)
          .where(eq(people.id, e.holderPersonId!))
          .limit(1),
      )
      return { tenantUserId: null, email: p?.email ?? null, userId: p?.userId ?? null }
    },
  }
}
