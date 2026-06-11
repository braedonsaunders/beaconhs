import Link from 'next/link'
import { Receipt } from 'lucide-react'
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import {
  Badge,
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
import {
  equipmentExpenses,
  equipmentItems,
  equipmentRates,
  equipmentTypes,
  orgUnits,
  truckLogEntries,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'

export const metadata = { title: 'Monthly charges' }
export const dynamic = 'force-dynamic'

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 2,
  }).format(n)
}

function parseMonth(raw: string | undefined): { year: number; month: number } {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split('-').map(Number)
    if (y && m && m >= 1 && m <= 12) return { year: y, month: m }
  }
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

function fmtMonth(y: number, m: number): string {
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
}

function monthRange(y: number, m: number): { start: string; end: string } {
  const start = new Date(y, m - 1, 1)
  const end = new Date(y, m, 0)
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

export default async function ChargesReport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const { year, month } = parseMonth(pickString(sp.month))
  const { start, end } = monthRange(year, month)
  const ctx = await requireRequestContext()

  const { expenseRows, hourRows, projects } = await ctx.db(async (tx) => {
    const expenseRows = await tx
      .select({
        orgUnitId: equipmentExpenses.chargedToOrgUnitId,
        amount: sql<string>`COALESCE(SUM(${equipmentExpenses.amount})::text, '0')`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(equipmentExpenses)
      .where(and(gte(equipmentExpenses.incurredOn, start), lte(equipmentExpenses.incurredOn, end)))
      .groupBy(equipmentExpenses.chargedToOrgUnitId)
    const hourRows = await tx
      .select({
        orgUnitId: truckLogEntries.siteOrgUnitId,
        equipmentItemId: truckLogEntries.equipmentItemId,
        hours: sql<string>`COALESCE(SUM(${truckLogEntries.hoursOnSite})::text, '0')`,
        days: sql<number>`COUNT(DISTINCT ${truckLogEntries.entryDate})::int`,
      })
      .from(truckLogEntries)
      .where(and(gte(truckLogEntries.entryDate, start), lte(truckLogEntries.entryDate, end)))
      .groupBy(truckLogEntries.siteOrgUnitId, truckLogEntries.equipmentItemId)
    // Join the type & rate so we can compute revenue per (item, project).
    const items = await tx
      .select({
        id: equipmentItems.id,
        typeId: equipmentItems.typeId,
        hourly: equipmentRates.hourly,
        daily: equipmentRates.daily,
        weekly: equipmentRates.weekly,
        monthly: equipmentRates.monthly,
      })
      .from(equipmentItems)
      .leftJoin(equipmentRates, eq(equipmentRates.typeId, equipmentItems.typeId))
    const rateByItem = new Map<string, (typeof items)[number]>()
    for (const it of items) rateByItem.set(it.id, it)
    const projects = await tx
      .select()
      .from(orgUnits)
      .where(sql`${orgUnits.level} IN ('project', 'customer', 'site')`)
      .orderBy(asc(orgUnits.name))
    return {
      expenseRows,
      hourRows: hourRows.map((h) => {
        const rate = rateByItem.get(h.equipmentItemId)
        const hours = Number(h.hours) || 0
        const revenue = (Number(rate?.hourly ?? 0) || 0) * hours
        return { ...h, revenue }
      }),
      projects,
    }
  })

  const projectMap = new Map(projects.map((p) => [p.id, p]))
  const rollup = new Map<
    string,
    { name: string; expenses: number; hours: number; revenue: number; equipmentCount: number }
  >()
  for (const e of expenseRows) {
    const key = e.orgUnitId ?? '__unassigned__'
    const cur = rollup.get(key) ?? {
      name: e.orgUnitId ? (projectMap.get(e.orgUnitId)?.name ?? 'Unknown') : 'Unassigned',
      expenses: 0,
      hours: 0,
      revenue: 0,
      equipmentCount: 0,
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
      equipmentCount: 0,
    }
    cur.hours += Number(h.hours) || 0
    cur.revenue += h.revenue
    cur.equipmentCount += 1
    rollup.set(key, cur)
  }
  const rolled = Array.from(rollup.entries()).map(([k, v]) => ({ key: k, ...v }))
  rolled.sort((a, b) => b.revenue + b.expenses - (a.revenue + a.expenses))

  const totalExpenses = rolled.reduce((s, r) => s + r.expenses, 0)
  const totalRevenue = rolled.reduce((s, r) => s + r.revenue, 0)
  const totalCharges = totalRevenue + totalExpenses

  // Month navigation links.
  const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="reports" />
          <PageHeader
            title="Monthly charges"
            description="Per-project rollup of equipment expenses + revenue (hourly rate × truck-log hours) for the selected month."
            back={{ href: '/equipment/reports', label: 'Back to reports' }}
            actions={
              <Link
                href={buildExportHref('/equipment/reports/charges/export.csv', {
                  month: `${year}-${String(month).padStart(2, '0')}`,
                })}
              >
                <Button variant="outline">Export CSV</Button>
              </Link>
            }
          />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Link
                href={`/equipment/reports/charges?month=${prev}` as any}
                className="text-xs text-teal-700 hover:underline"
              >
                ← Previous
              </Link>
              <div className="text-sm font-medium text-slate-700">{fmtMonth(year, month)}</div>
              <Link
                href={`/equipment/reports/charges?month=${next}` as any}
                className="text-xs text-teal-700 hover:underline"
              >
                Next →
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <Badge variant="success">{fmtMoney(totalRevenue)} revenue</Badge>
              <Badge variant="warning">{fmtMoney(totalExpenses)} expenses</Badge>
              <Badge variant="secondary">{fmtMoney(totalCharges)} chargeable</Badge>
            </div>
          </div>
        </>
      }
    >
      {rolled.length === 0 ? (
        <EmptyState
          icon={<Receipt size={32} />}
          title="No charges recorded for this month"
          description="No equipment expenses or truck-log hours fell within this month."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project / customer / site</TableHead>
                <TableHead className="text-right">Equipment used</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Revenue (hourly × hrs)</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">Total chargeable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rolled.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right">{r.equipmentCount}</TableCell>
                  <TableCell className="text-right">{r.hours.toFixed(1)}</TableCell>
                  <TableCell className="text-right text-emerald-700">
                    {fmtMoney(r.revenue)}
                  </TableCell>
                  <TableCell className="text-right text-amber-700">
                    {fmtMoney(r.expenses)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {fmtMoney(r.revenue + r.expenses)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ListPageLayout>
  )
}
