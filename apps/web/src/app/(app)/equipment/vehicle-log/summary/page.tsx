import Link from 'next/link'
import { asc, eq, gte, lt, sql } from 'drizzle-orm'
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
import { equipmentItems, equipmentTypes, truckLogEntries } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { buildHref, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'

export const metadata = { title: 'Vehicle log summary' }
export const dynamic = 'force-dynamic'

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
  const ctx = await requireRequestContext()

  const firstDay = ymd(year, 1, 1)
  const nextFirst = ymd(year + 1, 1, 1)

  const { trucks, rows } = await ctx.db(async (tx) => {
    const t = await tx
      .select({
        id: equipmentItems.id,
        assetTag: equipmentItems.assetTag,
        name: equipmentItems.name,
        category: equipmentTypes.category,
        typeName: equipmentTypes.name,
      })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .orderBy(asc(equipmentItems.assetTag))
      .limit(500)
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

  const vehicleTrucks = trucks.filter(
    (t) =>
      (t.category ?? '').toLowerCase().includes('vehicle') ||
      (t.typeName ?? '').toLowerCase().includes('truck'),
  )
  const displayTrucks = vehicleTrucks.length > 0 ? vehicleTrucks : trucks

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
  for (const r of rows) {
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
          <EquipmentSubNav active="vehicle-log" />
          <PageHeader
            title="Vehicle log summary"
            description={`Annual roll-up of km driven, hours on site, and manpower for ${year}.`}
            actions={
              <div className="flex items-center gap-2">
                <Link href={`/equipment/vehicle-log/summary?year=${year - 1}` as any}>
                  <Button variant="outline" size="sm">
                    ← {year - 1}
                  </Button>
                </Link>
                <Link href={`/equipment/vehicle-log/summary?year=${year + 1}` as any}>
                  <Button variant="outline" size="sm">
                    {year + 1} →
                  </Button>
                </Link>
                <Link href={buildHref('/equipment/vehicle-log/export.csv', { year }) as any}>
                  <Button>Export CSV</Button>
                </Link>
              </div>
            }
          />
          <div className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
            <span>Year</span>
            <form className="flex items-center gap-2" action="/equipment/vehicle-log/summary">
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
        </>
      }
    >
      {displayTrucks.length === 0 ? (
        <EmptyState
          icon={<Truck size={32} />}
          title="No equipment"
          description="Add equipment first, then log daily entries to populate the monthly roll-up."
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
              {displayTrucks.map((t) => {
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
                              {m.manpower} men
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
                        {totals.manpower} men
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
                      {m.manpower} men
                    </div>
                  </TableCell>
                ))}
                <TableCell className="bg-slate-50 text-right dark:bg-slate-800">
                  <div className="text-sm font-semibold">{grandTotals.km} km</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {grandTotals.hours.toFixed(1)} h
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {grandTotals.manpower} men
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </ListPageLayout>
  )
}
