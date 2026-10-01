import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { DownloadLink } from '@/components/download-link'
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
import { extractRows } from '@beaconhs/db'
import { equipmentCategories, equipmentItems, equipmentTypes } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { canReadVehicleLog, vehicleDriverScopeWhere } from '../_access-policy'
import { resolveVehicleEquipmentWhere } from '../_equipment-policy'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_062636ebd477e6') }
}
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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
  if (!canReadVehicleLog(ctx)) {
    redirect('/dashboard')
  }
  const canExport = can(ctx, 'admin.data.export') && can(ctx, 'equipment.read.all')

  const firstDay = ymd(year, 1, 1)
  const nextFirst = ymd(year + 1, 1, 1)

  const { trucks, rows, monthlyTotals, total } = await ctx.db(async (tx) => {
    const driverWhere = vehicleDriverScopeWhere(ctx, sql`monthly.driver_person_id`) ?? sql`true`
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
              monthly.logged_days
            FROM report_vehicle_log_monthly monthly
            WHERE monthly.equipment_item_id IN (${sql.join(
              pageIds.map((id) => sql`${id}`),
              sql`, `,
            )})
              AND ${driverWhere}
              AND monthly.month >= ${firstDay}::date
              AND monthly.month < ${nextFirst}::date
          `)
    const totalsResult = await tx.execute(sql`
      SELECT
        extract(month from monthly.month)::int AS month,
        coalesce(sum(monthly.total_km), 0) AS total_km,
        coalesce(sum(monthly.logged_days), 0) AS logged_days
      FROM report_vehicle_log_monthly monthly
      INNER JOIN ${equipmentItems}
        ON ${equipmentItems.id} = monthly.equipment_item_id
      LEFT JOIN ${equipmentTypes}
        ON ${equipmentTypes.id} = ${equipmentItems.typeId}
      LEFT JOIN ${equipmentCategories}
        ON ${equipmentCategories.id} = ${equipmentItems.categoryId}
      WHERE ${where}
        AND ${driverWhere}
        AND monthly.month >= ${firstDay}::date
        AND monthly.month < ${nextFirst}::date
      GROUP BY extract(month from monthly.month)
      ORDER BY extract(month from monthly.month)
    `)
    const r = extractRows(result).map((row) => ({
      equipmentItemId: String(row.equipment_item_id ?? ''),
      month: Number(row.month ?? 0),
      kmTotal: Number(row.total_km ?? 0),
      entryDays: Number(row.logged_days ?? 0),
    }))
    const totals = extractRows(totalsResult).map((row) => ({
      month: Number(row.month ?? 0),
      kmTotal: Number(row.total_km ?? 0),
      entryDays: Number(row.logged_days ?? 0),
    }))
    return {
      trucks: t,
      rows: r,
      monthlyTotals: totals,
      total: Number(totalRow?.c ?? 0),
    }
  })

  type MonthRollup = { km: number; days: number }
  const grid = new Map<string, Map<number, MonthRollup>>()
  for (const r of rows) {
    const inner = grid.get(r.equipmentItemId) ?? new Map<number, MonthRollup>()
    const previous = inner.get(Number(r.month))
    inner.set(Number(r.month), {
      km: (previous?.km ?? 0) + Number(r.kmTotal ?? 0),
      days: (previous?.days ?? 0) + Number(r.entryDays ?? 0),
    })
    grid.set(r.equipmentItemId, inner)
  }

  const grandTotals = { km: 0, days: 0 }
  const monthTotals: MonthRollup[] = Array.from({ length: 12 }, () => ({
    km: 0,
    days: 0,
  }))
  const truckTotals = new Map<string, MonthRollup>()
  for (const r of monthlyTotals) {
    const km = Number(r.kmTotal ?? 0)
    const days = Number(r.entryDays ?? 0)
    grandTotals.km += km
    grandTotals.days += days
    const idx = Number(r.month) - 1
    if (idx >= 0 && idx < 12) {
      monthTotals[idx]!.km += km
      monthTotals[idx]!.days += days
    }
  }
  for (const r of rows) {
    const km = Number(r.kmTotal ?? 0)
    const days = Number(r.entryDays ?? 0)
    const tt = truckTotals.get(r.equipmentItemId) ?? { km: 0, days: 0 }
    tt.km += km
    tt.days += days
    truckTotals.set(r.equipmentItemId, tt)
  }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_062636ebd477e6')}
            description={tGenerated('m_083b7021fe4ccd', { value0: year })}
            actions={
              <div className="flex items-center gap-2">
                <Link href={{ pathname: BASE, query: { ...sp, year: year - 1, page: undefined } }}>
                  <Button variant="outline" size="sm">
                    ← <GeneratedValue value={year - 1} />
                  </Button>
                </Link>
                <Link href={{ pathname: BASE, query: { ...sp, year: year + 1, page: undefined } }}>
                  <Button variant="outline" size="sm">
                    <GeneratedValue value={year + 1} /> →
                  </Button>
                </Link>
                <GeneratedValue
                  value={
                    canExport ? (
                      <DownloadLink
                        href={{
                          pathname: '/equipment/vehicle-log/export.csv',
                          query: { year, q: params.q },
                        }}
                      >
                        <Button>
                          <GeneratedText id="m_14c6440eca1edc" />
                        </Button>
                      </DownloadLink>
                    ) : null
                  }
                />
              </div>
            }
          />
          <EquipmentSubNav active="vehicle-log" />
          <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
            <span>
              <GeneratedText id="m_1f69767390b86a" />
            </span>
            <form className="flex items-center gap-2" action="/equipment/vehicle-log/summary">
              <GeneratedValue
                value={params.q ? <input type="hidden" name="q" value={params.q} /> : null}
              />
              <input
                name="year"
                type="number"
                min="2000"
                max="2100"
                defaultValue={year}
                className="w-24 rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-800"
              />
              <Button type="submit" variant="outline" size="sm">
                <GeneratedText id="m_01185cdc1c20a5" />
              </Button>
            </form>
          </div>
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_016f56eb48416e')} />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          trucks.length === 0 ? (
            <EmptyState
              icon={<Truck size={32} />}
              title={tGeneratedValue(
                params.q ? tGenerated('m_0facdddbc34f7d') : tGenerated('m_0f44a06d1a2711'),
              )}
              description={tGeneratedValue(
                params.q ? tGenerated('m_03cbeaf84beb85') : tGenerated('m_1e6f192b7c254a'),
              )}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 bg-white dark:bg-slate-900">
                      <GeneratedText id="m_0b28fe409b19d3" />
                    </TableHead>
                    <GeneratedValue
                      value={MONTHS.map((m) => (
                        <TableHead
                          key={m}
                          className="text-center text-xs text-slate-500 dark:text-slate-400"
                        >
                          <GeneratedValue value={m} />
                        </TableHead>
                      ))}
                    />
                    <TableHead className="text-right">
                      <GeneratedText id="m_13829da903be72" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={trucks.map((t) => {
                      const months = grid.get(t.id) ?? new Map<number, MonthRollup>()
                      const totals = truckTotals.get(t.id) ?? {
                        km: 0,
                        days: 0,
                      }
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="sticky left-0 z-10 bg-white whitespace-nowrap dark:bg-slate-900">
                            <Link href={`/equipment/${t.id}`} className="hover:underline">
                              <div className="font-mono text-xs text-slate-500 dark:text-slate-400">
                                <GeneratedValue value={t.assetTag} />
                              </div>
                              <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                <GeneratedValue value={t.name} />
                              </div>
                            </Link>
                          </TableCell>
                          <GeneratedValue
                            value={MONTHS.map((_, i) => {
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
                                    href={
                                      `/equipment/vehicle-log?month=${year}-${pad2(i + 1)}` as any
                                    }
                                    className="block rounded bg-slate-50 px-1.5 py-1 text-[11px] hover:bg-teal-50 dark:bg-slate-800"
                                  >
                                    <div className="font-medium text-slate-900 dark:text-slate-100">
                                      <GeneratedValue value={m.km} />{' '}
                                      <GeneratedText id="m_052eec8e5ae8ca" />
                                    </div>
                                  </Link>
                                </TableCell>
                              )
                            })}
                          />
                          <TableCell className="text-right text-sm font-medium">
                            <div>
                              <GeneratedValue value={totals.km} />{' '}
                              <GeneratedText id="m_052eec8e5ae8ca" />
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  />
                  <TableRow>
                    <TableCell className="sticky left-0 z-10 bg-slate-50 font-semibold dark:bg-slate-800">
                      <GeneratedText id="m_1d7be7cee88a16" />
                    </TableCell>
                    <GeneratedValue
                      value={monthTotals.map((m, i) => (
                        <TableCell
                          key={i}
                          className="bg-slate-50 text-center align-top dark:bg-slate-800"
                        >
                          <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                            <GeneratedValue value={m.km} /> <GeneratedText id="m_052eec8e5ae8ca" />
                          </div>
                        </TableCell>
                      ))}
                    />
                    <TableCell className="bg-slate-50 text-right dark:bg-slate-800">
                      <div className="text-sm font-semibold">
                        <GeneratedValue value={grandTotals.km} />{' '}
                        <GeneratedText id="m_052eec8e5ae8ca" />
                      </div>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )
        }
      />
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
