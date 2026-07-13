// Builds the render data for equipment QR-label PDFs — one
// EquipmentLabelDesignData per item, shared by the single-label and bulk
// label routes (and the designer's sample preview stays in its own route).

import { and, inArray, isNull, max, min, eq } from 'drizzle-orm'
import QRCode from 'qrcode'
import type { Database } from '@beaconhs/db'
import {
  equipmentCategories,
  equipmentInspectionSchedules,
  equipmentItems,
  equipmentTypes,
  orgUnits,
} from '@beaconhs/db/schema'
import type { EquipmentLabelDesignData } from '@beaconhs/design-studio'
import type { SQL } from 'drizzle-orm'
import { appBaseUrl } from '@/lib/app-base-url'

function equipmentScanUrl(qrToken: string): string {
  return `${appBaseUrl()}/equipment/scan/${qrToken}`
}

async function equipmentQrDataUrl(scanUrl: string): Promise<string> {
  // margin 1 keeps a quiet zone inside the label's white QR panel so thermal
  // prints stay scannable edge-to-edge.
  return QRCode.toDataURL(scanUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 8,
    color: { dark: '#000000', light: '#ffffff' },
  })
}

/**
 * Load label data for the given (already visibility-scoped) item ids —
 * callers pass the same scope predicate they list/guard with. Returns rows in
 * asset-tag order; ids that are deleted or out of scope are silently dropped.
 */
export async function loadEquipmentLabelData(
  tx: Database,
  tenantName: string,
  ids: string[],
  scope: SQL<unknown> | undefined,
): Promise<EquipmentLabelDesignData[]> {
  if (ids.length === 0) return []
  const rows = await tx
    .select({
      id: equipmentItems.id,
      name: equipmentItems.name,
      assetTag: equipmentItems.assetTag,
      serialNumber: equipmentItems.serialNumber,
      qrToken: equipmentItems.qrToken,
      typeName: equipmentTypes.name,
      categoryName: equipmentCategories.name,
      siteName: orgUnits.name,
    })
    .from(equipmentItems)
    .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
    .leftJoin(equipmentCategories, eq(equipmentCategories.id, equipmentItems.categoryId))
    .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
    .where(
      and(
        inArray(equipmentItems.id, ids),
        isNull(equipmentItems.deletedAt),
        ...(scope ? [scope] : []),
      ),
    )
    .orderBy(equipmentItems.assetTag)

  if (rows.length === 0) return []

  // Inspection cadence: latest completed / earliest upcoming across the
  // item's ACTIVE recurring schedules; items without schedules print blank.
  const inspections = await tx
    .select({
      equipmentItemId: equipmentInspectionSchedules.equipmentItemId,
      lastCompletedOn: max(equipmentInspectionSchedules.lastCompletedOn),
      nextDueOn: min(equipmentInspectionSchedules.nextDueOn),
    })
    .from(equipmentInspectionSchedules)
    .where(
      and(
        inArray(
          equipmentInspectionSchedules.equipmentItemId,
          rows.map((r) => r.id),
        ),
        eq(equipmentInspectionSchedules.isActive, true),
      ),
    )
    .groupBy(equipmentInspectionSchedules.equipmentItemId)
  const inspectionByItem = new Map(inspections.map((i) => [i.equipmentItemId, i]))

  return Promise.all(
    rows.map(async (row) => {
      const scanUrl = equipmentScanUrl(row.qrToken)
      const inspection = inspectionByItem.get(row.id)
      return {
        tenantName,
        equipmentName: row.name,
        equipmentAssetTag: row.assetTag,
        equipmentSerial: row.serialNumber,
        equipmentClass: [row.categoryName, row.typeName].filter(Boolean).join(' • ') || null,
        equipmentDivision: row.siteName,
        lastInspection: inspection?.lastCompletedOn ?? null,
        nextInspectionDue: inspection?.nextDueOn ?? null,
        verifyUrl: scanUrl,
        qrDataUrl: await equipmentQrDataUrl(scanUrl),
      } satisfies EquipmentLabelDesignData
    }),
  )
}
