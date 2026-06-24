import type { NextRequest } from 'next/server'
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import {
  equipmentExpenses,
  equipmentItems,
  equipmentRates,
  orgUnits,
  truckLogEntries,
} from '@beaconhs/db/schema'
import { requireExportContext } from '@/lib/auth'
import { csvFilename, csvResponse } from '@/lib/csv'
import { pickString } from '@/lib/list-params'

function parseMonth(raw: string | undefined): { year: number; month: number } {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split('-').map(Number)
    if (y && m && m >= 1 && m <= 12) return { year: y, month: m }
  }
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

export async function GET(req: NextRequest) {
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
  const { year, month } = parseMonth(pickString(sp.month))
  const start = new Date(year, month - 1, 1).toISOString().slice(0, 10)
  const end = new Date(year, month, 0).toISOString().slice(0, 10)

  const ctx = await requireExportContext()
  const { rolled } = await ctx.db(async (tx) => {
    const expenseRows = await tx
      .select({
        orgUnitId: equipmentExpenses.chargedToOrgUnitId,
        amount: sql<string>`COALESCE(SUM(${equipmentExpenses.amount})::text, '0')`,
      })
      .from(equipmentExpenses)
      .where(and(gte(equipmentExpenses.incurredOn, start), lte(equipmentExpenses.incurredOn, end)))
      .groupBy(equipmentExpenses.chargedToOrgUnitId)
    const hourRows = await tx
      .select({
        orgUnitId: truckLogEntries.siteOrgUnitId,
        equipmentItemId: truckLogEntries.equipmentItemId,
        hours: sql<string>`COALESCE(SUM(${truckLogEntries.hoursOnSite})::text, '0')`,
      })
      .from(truckLogEntries)
      .where(and(gte(truckLogEntries.entryDate, start), lte(truckLogEntries.entryDate, end)))
      .groupBy(truckLogEntries.siteOrgUnitId, truckLogEntries.equipmentItemId)
    const items = await tx
      .select({ id: equipmentItems.id, hourly: equipmentRates.hourly })
      .from(equipmentItems)
      .leftJoin(equipmentRates, eq(equipmentRates.typeId, equipmentItems.typeId))
    const rateByItem = new Map(items.map((i) => [i.id, Number(i.hourly ?? 0) || 0]))
    const projects = await tx
      .select()
      .from(orgUnits)
      .where(sql`${orgUnits.level} IN ('project', 'customer', 'site')`)
      .orderBy(asc(orgUnits.name))
    const projectMap = new Map(projects.map((p) => [p.id, p]))
    const rollup = new Map<
      string,
      { name: string; expenses: number; hours: number; revenue: number; count: number }
    >()
    for (const e of expenseRows) {
      const key = e.orgUnitId ?? '__unassigned__'
      const cur = rollup.get(key) ?? {
        name: e.orgUnitId ? (projectMap.get(e.orgUnitId)?.name ?? 'Unknown') : 'Unassigned',
        expenses: 0,
        hours: 0,
        revenue: 0,
        count: 0,
      }
      cur.expenses += Number(e.amount) || 0
      rollup.set(key, cur)
    }
    for (const h of hourRows) {
      const key = h.orgUnitId ?? '__unassigned__'
      const cur = rollup.get(key) ?? {
        name: h.orgUnitId ? (projectMap.get(h.orgUnitId)?.name ?? 'Unknown') : 'Unassigned',
        expenses: 0,
        hours: 0,
        revenue: 0,
        count: 0,
      }
      const hours = Number(h.hours) || 0
      cur.hours += hours
      cur.revenue += rateByItem.get(h.equipmentItemId) ?? 0
      cur.revenue += (rateByItem.get(h.equipmentItemId) ?? 0) * hours
      cur.count += 1
      rollup.set(key, cur)
    }
    return { rolled: Array.from(rollup.values()) }
  })

  return csvResponse({
    filename: csvFilename(`equipment-charges-${year}-${String(month).padStart(2, '0')}`),
    headers: [
      'Project / customer / site',
      'Equipment used',
      'Hours',
      'Revenue',
      'Expenses',
      'Total chargeable',
    ],
    rows: rolled.map((r) => [
      r.name,
      r.count,
      r.hours.toFixed(1),
      r.revenue.toFixed(2),
      r.expenses.toFixed(2),
      (r.revenue + r.expenses).toFixed(2),
    ]),
  })
}
