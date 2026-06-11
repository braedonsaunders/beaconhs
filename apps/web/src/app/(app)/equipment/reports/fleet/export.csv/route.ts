import { asc, eq, sql } from 'drizzle-orm'
import {
  equipmentExpenses,
  equipmentItems,
  equipmentTypes,
  orgUnits,
  people,
  truckLogEntries,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { csvFilename, csvResponse } from '@/lib/csv'

export async function GET() {
  const ctx = await requireRequestContext()
  const yearStart = new Date()
  yearStart.setMonth(0, 1)
  yearStart.setHours(0, 0, 0, 0)
  const yearStartIso = yearStart.toISOString().slice(0, 10)

  const rows = await ctx.db((tx) =>
    tx
      .select({
        item: equipmentItems,
        type: equipmentTypes,
        site: orgUnits,
        holder: people,
        hoursYtd: sql<string>`(
          SELECT COALESCE(SUM(${truckLogEntries.hoursOnSite})::text, '0')
          FROM truck_log_entries
          WHERE truck_log_entries.equipment_item_id = ${equipmentItems.id}
            AND truck_log_entries.entry_date >= ${yearStartIso}
        )`,
        kmYtd: sql<string>`(
          SELECT COALESCE(SUM(${truckLogEntries.kmDriven})::text, '0')
          FROM truck_log_entries
          WHERE truck_log_entries.equipment_item_id = ${equipmentItems.id}
            AND truck_log_entries.entry_date >= ${yearStartIso}
        )`,
        expensesYtd: sql<string>`(
          SELECT COALESCE(SUM(${equipmentExpenses.amount})::text, '0')
          FROM equipment_expenses
          WHERE equipment_expenses.equipment_item_id = ${equipmentItems.id}
            AND equipment_expenses.incurred_on >= ${yearStartIso}
        )`,
      })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
      .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
      .orderBy(asc(equipmentItems.assetTag)),
  )

  return csvResponse({
    filename: csvFilename('fleet-report'),
    headers: [
      'Asset tag',
      'Name',
      'Type',
      'Status',
      'Current site',
      'Holder',
      'Hours YTD',
      'Km YTD',
      'Expenses YTD',
      'Last annual',
      'Next annual due',
      'Last pre-use',
      'Last oil change',
      'Next oil change',
    ],
    rows: rows.map(({ item, type, site, holder, hoursYtd, kmYtd, expensesYtd }) => [
      item.assetTag,
      item.name,
      type?.name ?? '',
      item.status,
      site?.name ?? '',
      holder ? `${holder.firstName} ${holder.lastName}` : '',
      Number(hoursYtd).toFixed(1),
      kmYtd,
      Number(expensesYtd).toFixed(2),
      item.lastAnnualInspectionOn ?? '',
      item.nextAnnualInspectionDue ?? '',
      item.lastPreUseInspectionAt
        ? new Date(item.lastPreUseInspectionAt).toISOString().slice(0, 10)
        : '',
      item.lastOilChangeOn ?? '',
      item.nextOilChangeDue ?? '',
    ]),
  })
}
