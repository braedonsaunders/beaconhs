import Link from 'next/link'
import { redirect } from 'next/navigation'
import { and, asc, count, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import {
  Button,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { Truck } from 'lucide-react'
import { extractRows } from '@beaconhs/reports'
import { equipmentCategories, equipmentItems, equipmentTypes } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { resolveVehicleEquipmentWhere } from '../_equipment-policy'

export const metadata = { title: 'Vehicle log summary' }
export const dynamic = 'force-dynamic'
const BASE = '/equipment/vehicle-log/summary'
const SORTS = ['asset_tag'] as const

function parseYear(raw: string | undefined): number {
  if (raw && /^\d{4}$/.test(raw)) return Number(raw)
  return new Date().getFullYear()
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function ymd(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`
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
] as const

export default async function TruckLogSummaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const year = parseYear(pickString(sp.year))
  const params = parseListParams(sp, {
    sort: 'asset_tag',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const ctx = await requireRequestContext()
  // Same read-tier gate as /equipment/vehicle-log — this is a tenant-wide
  // fleet roll-up.
  if (
    !can(ctx, 'equipment.read.all') &&
    !can(ctx, 'equipment.read.site') &&
    !can(ctx, 'equipment.manage')
  ) {
    redirect('/dashboard')
  }
  const canExport = can(ctx, 'admin.data.export') && can(ctx, 'equipment.read.all')

  const firstDay = ymd(year, 1, 1)
  const nextFirst = ymd(year + 1, 1, 1)

  const { trucks, rows, monthlyTotals, total } = await ctx.db(async (tx) => {
    const { where: vehicleWhere } = await resolveVehicleEquipmentWhere(ctx, tx)
    const search: SQL<unknown> | undefined = params.q
      ? or(
          ilike(equipmentItems.assetTag, `%${params.q}%`),
          ilike(equipmentItems.name, `%${params.q}%`),
          ilike(equipmentCategories.name, `%${params.q}%`),
          ilike(equipmentTypes.name, `%${params.q}%`),
        )
      : undefined
    const where = and(vehicleWhere, search)!
    const [totalRow] = await tx
      .select({ c: count() })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(equipmentCategories, eq(equipmentCategories.id, equipmentItems.categoryId))
      .where(where)
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
      .where(where)
      .orderBy(asc(equipmentItems.assetTag))
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const pageIds = t.map((truck) => truck.id)
    const result =
      pageIds.length === 0
        ? []
        : await tx.execute(sql`
            SELECT
              monthly.equipment_item_id,
              extract(month from monthly.month)::int AS month,
              monthly.total_km,
              monthly.hours_on_site,
              monthly.manpower_count,
              monthly.logged_days
            FROM report_vehicle_log_monthly monthly
            WHERE monthly.equipment_item_id IN (${sql.join(
              pageIds.map((id) => sql`${id}`),
              sql`, `,
            )})
              AND monthly.month >= ${firstDay}::date
              AND monthly.month < ${nextFirst}::date
          `)
    const totalsResult = await tx.execute(sql`
      SELECT
        extract(month from monthly.month)::int AS month,
        coalesce(sum(monthly.total_km), 0) AS total_km,
        coalesce(sum(monthly.hours_on_site), 0) AS hours_on_site,
        coalesce(sum(monthly.manpower_count), 0) AS manpower_count,
        coalesce(sum(monthly.logged_days), 0) AS logged_days
      FROM report_vehicle_log_monthly monthly
      INNER JOIN ${equipmentItems}
        ON ${equipmentItems.id} = monthly.equipment_item_id
      LEFT JOIN ${equipmentTypes}
        ON ${equipmentTypes.id} = ${equipmentItems.typeId}
      LEFT JOIN ${equipmentCategories}
        ON ${equipmentCategories.id} = ${equipmentItems.categoryId}
      WHERE ${where}
        AND monthly.month >= ${firstDay}::date
        AND monthly.month < ${nextFirst}::date
      GROUP BY extract(month from monthly.month)
      ORDER BY extract(month from monthly.month)
    `)
    const r = extractRows(result).map((row) => ({
      equipmentItemId: String(row.equipment_item_id ?? ''),
      month: Number(row.month ?? 0),
      kmTotal: Number(row.total_km ?? 0),
      hoursTotal: Number(row.hours_on_site ?? 0),
      manpowerTotal: Number(row.manpower_count ?? 0),
      entryDays: Number(row.logged_days ?? 0),
    }))
    const totals = extractRows(totalsResult).map((row) => ({
      month: Number(row.month ?? 0),
      kmTotal: Number(row.total_km ?? 0),
      hoursTotal: Number(row.hours_on_site ?? 0),
      manpowerTotal: Number(row.manpower_count ?? 0),
      entryDays: Number(row.logged_days ?? 0),
    }))
    return {
      trucks: t,
      rows: r,
      monthlyTotals: totals,
      total: Number(totalRow?.c ?? 0),
    }
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

  const grandTotals = { km: 0, hours: 0, manpower: 0, days: 0 }
  const monthTotals: MonthRollup[] = Array.from({ length: 12 }, () => ({
    km: 0,
    hours: 0,
    manpower: 0,
    days: 0,
  }))
  const truckTotals = new Map<string, MonthRollup>()
  for (const r of monthlyTotals) {
    const km = Number(r.kmTotal ?? 0)
    const hours = Number(r.hoursTotal ?? 0)
    const man = Number(r.manpowerTotal ?? 0)
    const days = Number(r.entryDays ?? 0)
    grandTotals.km += km
    grandTotals.hours += hours
    grandTotals.manpower += man
    grandTotals.days += days
    const idx = Number(r.month) - 1
    if (idx >= 0 && idx < 12) {
      monthTotals[idx]!.km += km
      monthTotals[idx]!.hours += hours
      monthTotals[idx]!.manpower += man
      monthTotals[idx]!.days += days
    }
  }
  for (const r of rows) {
    const km = Number(r.kmTotal ?? 0)
    const hours = Number(r.hoursTotal ?? 0)
    const man = Number(r.manpowerTotal ?? 0)
    const days = Number(r.entryDays ?? 0)
    const tt = truckTotals.get(r.equipmentItemId) ?? { km: 0, hours: 0, manpower: 0, days: 0 }
    tt.km += km
    tt.hours += hours
    tt.manpower += man
    tt.days += days
    truckTotals.set(r.equipmentItemId, tt)
  }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Vehicle log summary"
            description={`Annual roll-up of km driven, hours on site, and crew count for ${year}.`}
            actions={
              <div className="flex items-center gap-2">
                <Link href={{ pathname: BASE, query: { ...sp, year: year - 1, page: undefined } }}>
                  <Button variant="outline" size="sm">
                    ← {year - 1}
                  </Button>
                </Link>
                <Link href={{ pathname: BASE, query: { ...sp, year: year + 1, page: undefined } }}>
                  <Button variant="outline" size="sm">
                    {year + 1} →
                  </Button>
                </Link>
                {canExport ? (
                  <Link
                    href={{
                      pathname: '/equipment/vehicle-log/export.csv',
                      query: { year, q: params.q },
                    }}
                  >
                    <Button>Export CSV</Button>
                  </Link>
                ) : null}
              </div>
            }
          />
          <EquipmentSubNav active="vehicle-log" />
          <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
            <span>Year</span>
            <form className="flex items-center gap-2" action="/equipment/vehicle-log/summary">
              {params.q ? <input type="hidden" name="q" value={params.q} /> : null}
              <input
                name="year"
                type="number"
                min="2000"
                max="2100"
                defaultValue={year}
                className="w-24 rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-800"
              />
              <Button type="submit" variant="outline" size="sm">
                Apply
              </Button>
            </form>
          </div>
          <TableToolbar>
            <SearchInput placeholder="Search asset tag, name, category, or type…" />
          </TableToolbar>
        </>
      }
    >
      {trucks.length === 0 ? (
        <EmptyState
          icon={<Truck size={32} />}
          title={params.q ? 'No vehicles match your search' : 'No equipment'}
          description={
            params.q
              ? 'Clear the search to see other accessible vehicles.'
              : 'Add equipment first, then log daily entries to populate the monthly roll-up.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 bg-white dark:bg-slate-900">
                  Truck
                </TableHead>
                {MONTHS.map((m) => (
                  <TableHead
                    key={m}
                    className="text-center text-xs text-slate-500 dark:text-slate-400"
                  >
                    {m}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trucks.map((t) => {
                const months = grid.get(t.id) ?? new Map<number, MonthRollup>()
                const totals = truckTotals.get(t.id) ?? { km: 0, hours: 0, manpower: 0, days: 0 }
                return (
                  <TableRow key={t.id}>
                    <TableCell className="sticky left-0 z-10 bg-white whitespace-nowrap dark:bg-slate-900">
                      <Link href={`/equipment/${t.id}`} className="hover:underline">
                        <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                          {t.assetTag}
                        </div>
                        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                          {t.name}
                        </div>
                      </Link>
                    </TableCell>
                    {MONTHS.map((_, i) => {
                      const m = months.get(i + 1)
                      if (!m)
                        return (
                          <TableCell key={i} className="text-center text-xs text-slate-300">
                            —
                          </TableCell>
                        )
                      return (
                        <TableCell key={i} className="text-center align-top">
                          <Link
                            href={`/equipment/vehicle-log?month=${year}-${pad2(i + 1)}` as any}
                            className="block rounded bg-slate-50 px-1.5 py-1 text-[11px] hover:bg-teal-50 dark:bg-slate-800"
                          >
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {m.km} km
                            </div>
                            <div className="text-slate-500 dark:text-slate-400">
                              {m.hours.toFixed(1)} h
                            </div>
                            <div className="text-slate-500 dark:text-slate-400">
                              {m.manpower} crew
                            </div>
                          </Link>
                        </TableCell>
                      )
                    })}
                    <TableCell className="text-right text-sm font-medium">
                      <div>{totals.km} km</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {totals.hours.toFixed(1)} h
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {totals.manpower} crew
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
              <TableRow>
                <TableCell className="sticky left-0 z-10 bg-slate-50 font-semibold dark:bg-slate-800">
                  Totals
                </TableCell>
                {monthTotals.map((m, i) => (
                  <TableCell
                    key={i}
                    className="bg-slate-50 text-center align-top dark:bg-slate-800"
                  >
                    <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                      {m.km} km
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {m.hours.toFixed(1)} h
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {m.manpower} crew
                    </div>
                  </TableCell>
                ))}
                <TableCell className="bg-slate-50 text-right dark:bg-slate-800">
                  <div className="text-sm font-semibold">{grandTotals.km} km</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {grandTotals.hours.toFixed(1)} h
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {grandTotals.manpower} crew
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination
        basePath={BASE}
        currentParams={sp}
        total={total}
        page={params.page}
        perPage={params.perPage}
      />
    </ListPageLayout>
  )
}
