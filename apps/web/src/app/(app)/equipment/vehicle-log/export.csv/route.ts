import type { NextRequest } from 'next/server'
import { asc, eq, sql } from 'drizzle-orm'
import { extractRows } from '@beaconhs/reports'
import { equipmentCategories, equipmentItems, equipmentTypes } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireExportContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { csvColumns, selectCsvColumns } from '@/lib/export-columns'

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
  const ctx = await requireExportContext()
  // Tenant-wide fleet summary grid: gate on the full read tier (a site-scoped
  // export would distort the cross-vehicle totals rather than bound them).
  assertCan(ctx, 'equipment.read.all')

  const firstDay = ymd(year, 1, 1)
  const nextFirst = ymd(year + 1, 1, 1)

  const { trucks, rows } = await ctx.db(async (tx) => {
    const t = await tx
      .select({
        id: equipmentItems.id,
        assetTag: equipmentItems.assetTag,
        name: equipmentItems.name,
        category: equipmentCategories.name,
        typeName: equipmentTypes.name,
      })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(equipmentCategories, eq(equipmentCategories.id, equipmentItems.categoryId))
      .orderBy(asc(equipmentItems.assetTag))
      .limit(1000)
    const result = await tx.execute(sql`
      SELECT
        equipment_item_id,
        extract(month from month)::int AS month,
        total_km,
        hours_on_site,
        manpower_count,
        logged_days
      FROM report_vehicle_log_monthly
      WHERE month >= ${firstDay}::date AND month < ${nextFirst}::date
    `)
    const r = extractRows(result).map((row) => ({
      equipmentItemId: String(row.equipment_item_id ?? ''),
      month: Number(row.month ?? 0),
      kmTotal: Number(row.total_km ?? 0),
      hoursTotal: Number(row.hours_on_site ?? 0),
      manpowerTotal: Number(row.manpower_count ?? 0),
      entryDays: Number(row.logged_days ?? 0),
    }))
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
    ...MONTHS.flatMap((m) => [`${m} km`, `${m} hours`, `${m} crew count`]),
    'Total km',
    'Total hours',
    'Total crew count',
  ]

  const csvRows: (string | number | null)[][] = trucks.map((t) => {
    const months = grid.get(t.id) ?? new Map<number, MonthRollup>()
    let totalKm = 0
    let totalHours = 0
    let totalMan = 0
    const cells: (string | number)[] = [t.assetTag, t.name]
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
    summary: `Exported ${year} vehicle log summary (${trucks.length} vehicles)`,
    metadata: { format: 'csv', year },
  })

  const selection = selectCsvColumns(url.searchParams, csvColumns(headers))

  return csvResponse({
    filename: csvFilename(`vehicle-log-summary-${year}`),
    headers: selection.headers,
    rows: csvRows.map((row) => selection.project(row)),
  })
}
