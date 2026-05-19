import { asc, eq, sql } from 'drizzle-orm'
import {
  equipmentExpenses,
  equipmentItems,
  equipmentRates,
  equipmentTypes,
  truckLogEntries,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { csvFilename, csvResponse } from '@/lib/csv'

export async function GET() {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx
      .select({
        item: equipmentItems,
        type: equipmentTypes,
        rate: equipmentRates,
        hoursTotal: sql<string>`(
          SELECT COALESCE(SUM(${truckLogEntries.hoursOnSite})::text, '0')
          FROM truck_log_entries
          WHERE truck_log_entries.equipment_item_id = ${equipmentItems.id}
        )`,
        expensesTotal: sql<string>`(
          SELECT COALESCE(SUM(${equipmentExpenses.amount})::text, '0')
          FROM equipment_expenses
          WHERE equipment_expenses.equipment_item_id = ${equipmentItems.id}
        )`,
      })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(equipmentRates, eq(equipmentRates.typeId, equipmentItems.typeId))
      .orderBy(asc(equipmentItems.assetTag)),
  )

  const computed = rows.map((r) => {
    const hours = Number(r.hoursTotal) || 0
    const hourly = Number(r.rate?.hourly ?? 0) || 0
    const revenue = hourly * hours
    const expenses = Number(r.expensesTotal) || 0
    const purchase = Number(r.item.purchasePrice ?? 0) || 0
    const net = revenue - expenses - purchase
    return { ...r, hours, hourly, revenue, expenses, purchase, net }
  })

  return csvResponse({
    filename: csvFilename('equipment-roi'),
    headers: [
      'Asset tag',
      'Name',
      'Type',
      'Hours',
      'Hourly rate',
      'Revenue',
      'Expenses',
      'Purchase price',
      'Net',
    ],
    rows: computed.map((r) => [
      r.item.assetTag,
      r.item.name,
      r.type?.name ?? '',
      r.hours.toFixed(1),
      r.hourly.toFixed(2),
      r.revenue.toFixed(2),
      r.expenses.toFixed(2),
      r.purchase.toFixed(2),
      r.net.toFixed(2),
    ]),
  })
}
