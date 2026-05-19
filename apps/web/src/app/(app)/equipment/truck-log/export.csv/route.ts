import type { NextRequest } from 'next/server'
import { asc, eq, sql } from 'drizzle-orm'
import { equipmentItems, equipmentTypes, truckLogEntries } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'

export const dynamic = 'force-dynamic'

function pad2(n: number) {
  return String(n).padStart(2, '0')
}
function ymd(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const yearRaw = url.searchParams.get('year')
  const year = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : new Date().getFullYear()
  const ctx = await requireRequestContext()

  const firstDay = ymd(year, 1, 1)
  const nextFirst = ymd(year + 1, 1, 1)

  const { trucks, rows } = await ctx.db(async (tx) => {
    const t = await tx
      .select({
        id: equipmentItems.id,
        assetTag: equipmentItems.assetTag,
        name: equipmentItems.name,
        billing: equipmentItems.billingRateCategory,
        category: equipmentTypes.category,
        typeName: equipmentTypes.name,
      })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .orderBy(asc(equipmentItems.assetTag))
      .limit(1000)
    const r = await tx
      .select({
        equipmentItemId: truckLogEntries.equipmentItemId,
        month: sql<number>`extract(month from ${truckLogEntries.entryDate})::int`,
        kmTotal: sql<number>`coalesce(sum(${truckLogEntries.kmDriven}), 0)::int`,
        hoursTotal: sql<number>`coalesce(sum(${truckLogEntries.hoursOnSite}), 0)::float`,
        manpowerTotal: sql<number>`coalesce(sum(${truckLogEntries.manpowerCount}), 0)::int`,
        entryDays: sql<number>`count(*)::int`,
      })
      .from(truckLogEntries)
      .where(
        sql`${truckLogEntries.entryDate} >= ${firstDay}::date AND ${truckLogEntries.entryDate} < ${nextFirst}::date`,
      )
      .groupBy(
        truckLogEntries.equipmentItemId,
        sql`extract(month from ${truckLogEntries.entryDate})`,
      )
    return { trucks: t, rows: r }
  })

  type MonthRollup = { km: number; hours: number; manpower: number; days: number }
  const grid = new Map<string, Map<number, MonthRollup>>()
  for (const r of rows) {
    const inner = grid.get(r.equipmentItemId) ?? new Map<number, MonthRollup>()
    inner.set(Number(r.month), {
      km: Number(r.kmTotal ?? 0),
      hours: Number(r.hoursTotal ?? 0),
      manpower: Number(r.manpowerTotal ?? 0),
      days: Number(r.entryDays ?? 0),
    })
    grid.set(r.equipmentItemId, inner)
  }

  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  const headers = [
    'Asset tag',
    'Name',
    'Billing category',
    ...MONTHS.flatMap((m) => [`${m} km`, `${m} hours`, `${m} manpower`]),
    'Total km',
    'Total hours',
    'Total manpower',
  ]

  const csvRows: (string | number | null)[][] = trucks.map((t) => {
    const months = grid.get(t.id) ?? new Map<number, MonthRollup>()
    let totalKm = 0
    let totalHours = 0
    let totalMan = 0
    const cells: (string | number)[] = [t.assetTag, t.name, t.billing ?? '']
    for (let i = 1; i <= 12; i++) {
      const m = months.get(i)
      const km = m?.km ?? 0
      const h = m?.hours ?? 0
      const man = m?.manpower ?? 0
      totalKm += km
      totalHours += h
      totalMan += man
      cells.push(km, Number(h.toFixed(2)), man)
    }
    cells.push(totalKm, Number(totalHours.toFixed(2)), totalMan)
    return cells
  })

  await recordAudit(ctx, {
    entityType: 'truck_log_entry',
    action: 'export',
    summary: `Exported ${year} truck log summary (${trucks.length} trucks)`,
    metadata: { format: 'csv', year },
  })

  return csvResponse({
    filename: csvFilename(`truck-log-summary-${year}`),
    headers,
    rows: csvRows,
  })
}
