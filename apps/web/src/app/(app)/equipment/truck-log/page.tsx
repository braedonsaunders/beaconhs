import Link from 'next/link'
import { Truck } from 'lucide-react'
import { and, asc, eq, gte, lt } from 'drizzle-orm'
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
import { equipmentItems, equipmentTypes, truckLogEntries } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'

export const metadata = { title: 'Truck log' }
export const dynamic = 'force-dynamic'

function parseMonth(raw: string | undefined): { year: number; month: number } {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split('-').map(Number)
    if (y && m && m >= 1 && m <= 12) return { year: y, month: m }
  }
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

function fmtMonthLabel(y: number, m: number) {
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
}

function shiftMonth(y: number, m: number, delta: number) {
  const total = y * 12 + (m - 1) + delta
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return { year: ny, month: nm }
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function ymd(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate()
}

export default async function TruckLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const { year, month } = parseMonth(pickString(sp.month))
  const ctx = await requireRequestContext()

  const firstDay = ymd(year, month, 1)
  const next = shiftMonth(year, month, 1)
  const nextFirst = ymd(next.year, next.month, 1)
  const prev = shiftMonth(year, month, -1)

  const { trucks, entries } = await ctx.db(async (tx) => {
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
      .limit(200)
    const e = await tx
      .select()
      .from(truckLogEntries)
      .where(
        and(
          gte(truckLogEntries.entryDate, firstDay),
          lt(truckLogEntries.entryDate, nextFirst),
        ),
      )
      .orderBy(asc(truckLogEntries.entryDate))
    return { trucks: t, entries: e }
  })

  // Prefer vehicles (by type category), but fall back to all if none flagged.
  const vehicleTrucks = trucks.filter(
    (t) => (t.category ?? '').toLowerCase().includes('vehicle') || (t.typeName ?? '').toLowerCase().includes('truck'),
  )
  const displayTrucks = vehicleTrucks.length > 0 ? vehicleTrucks : trucks

  const totalDays = daysInMonth(year, month)
  const grid = new Map<string, Map<number, { id: string; km: number | null }>>()
  for (const e of entries) {
    const day = Number(e.entryDate.slice(8, 10))
    const inner = grid.get(e.equipmentItemId) ?? new Map<number, { id: string; km: number | null }>()
    inner.set(day, { id: e.id, km: e.kmDriven ?? null })
    grid.set(e.equipmentItemId, inner)
  }

  const totalsByTruck = new Map<string, number>()
  for (const e of entries) {
    if (typeof e.kmDriven === 'number') {
      totalsByTruck.set(e.equipmentItemId, (totalsByTruck.get(e.equipmentItemId) ?? 0) + e.kmDriven)
    }
  }

  const monthParamPrev = `${prev.year}-${pad2(prev.month)}`
  const monthParamNext = `${next.year}-${pad2(next.month)}`

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="truck-log" />
          <PageHeader
            title="Truck log"
            description="Per-day per-truck odometer, manpower, and hours. Powers the monthly billing summary."
            actions={
              <div className="flex items-center gap-2">
                <Link href={'/equipment/truck-log/summary' as any}>
                  <Button variant="outline">Monthly summary</Button>
                </Link>
                <Link href={`/equipment/truck-log/new?month=${year}-${pad2(month)}` as any}>
                  <Button>New entry</Button>
                </Link>
              </div>
            }
          />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Link href={`/equipment/truck-log?month=${monthParamPrev}` as any}>
                <Button variant="outline" size="sm">
                  ← Previous
                </Button>
              </Link>
              <div className="text-sm font-medium text-slate-700">{fmtMonthLabel(year, month)}</div>
              <Link href={`/equipment/truck-log?month=${monthParamNext}` as any}>
                <Button variant="outline" size="sm">
                  Next →
                </Button>
              </Link>
            </div>
            <div className="text-xs text-slate-500">
              {entries.length} entries · {displayTrucks.length} trucks
            </div>
          </div>
        </>
      }
    >
      {displayTrucks.length === 0 ? (
        <EmptyState
          icon={<Truck size={32} />}
          title="No equipment to log"
          description="Add equipment first, then capture daily truck-log entries here."
          action={
            <Link href="/equipment/new">
              <Button>Add equipment</Button>
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 bg-white">Truck</TableHead>
                {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => (
                  <TableHead key={d} className="px-1 text-center text-[11px] text-slate-500">
                    {d}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total km</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayTrucks.map((t) => {
                const row = grid.get(t.id) ?? new Map<number, { id: string; km: number | null }>()
                const total = totalsByTruck.get(t.id) ?? 0
                return (
                  <TableRow key={t.id}>
                    <TableCell className="sticky left-0 z-10 whitespace-nowrap bg-white">
                      <Link href={`/equipment/${t.id}`} className="hover:underline">
                        <div className="font-mono text-xs text-slate-500">{t.assetTag}</div>
                        <div className="text-sm font-medium text-slate-900">{t.name}</div>
                      </Link>
                    </TableCell>
                    {Array.from({ length: totalDays }, (_, i) => i + 1).map((d) => {
                      const cell = row.get(d)
                      if (!cell) {
                        const date = ymd(year, month, d)
                        return (
                          <TableCell key={d} className="px-1 text-center align-middle">
                            <Link
                              href={
                                `/equipment/truck-log/new?truckId=${t.id}&date=${date}` as any
                              }
                              className="block py-1 text-[11px] text-slate-300 hover:text-teal-700"
                            >
                              ·
                            </Link>
                          </TableCell>
                        )
                      }
                      return (
                        <TableCell key={d} className="px-1 text-center align-middle">
                          <Link
                            href={`/equipment/truck-log/${cell.id}` as any}
                            className="block rounded bg-teal-50 px-1.5 py-1 text-[11px] font-medium text-teal-800 hover:bg-teal-100"
                          >
                            {cell.km ?? '·'}
                          </Link>
                        </TableCell>
                      )
                    })}
                    <TableCell className="text-right font-medium">{total || '—'}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </ListPageLayout>
  )
}
