import Link from 'next/link'
import { BarChart3 } from 'lucide-react'
import { asc, eq, sql } from 'drizzle-orm'
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
  truckLogEntries,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'

export const metadata = { title: 'Equipment ROI' }
export const dynamic = 'force-dynamic'

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(n)
}

export default async function RoiReport() {
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
  computed.sort((a, b) => b.net - a.net)

  const totalRevenue = computed.reduce((s, r) => s + r.revenue, 0)
  const totalExpenses = computed.reduce((s, r) => s + r.expenses, 0)
  const totalPurchase = computed.reduce((s, r) => s + r.purchase, 0)
  const totalNet = computed.reduce((s, r) => s + r.net, 0)

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="reports" />
          <PageHeader
            title="Return on investment"
            description="Per-asset revenue (hourly rate × hours) minus expenses minus purchase price. Hourly rates come from /equipment/rates."
            back={{ href: '/equipment/reports', label: 'Back to reports' }}
            actions={
              <Link href={buildExportHref('/equipment/reports/roi/export.csv', {})}>
                <Button variant="outline">Export CSV</Button>
              </Link>
            }
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Badge variant="success">{fmtMoney(totalRevenue)} revenue</Badge>
            <Badge variant="warning">{fmtMoney(totalExpenses)} expenses</Badge>
            <Badge variant="secondary">{fmtMoney(totalPurchase)} purchase</Badge>
            <Badge variant={totalNet >= 0 ? 'success' : 'destructive'}>
              {fmtMoney(totalNet)} net
            </Badge>
          </div>
        </>
      }
    >
      {computed.length === 0 ? (
        <EmptyState
          icon={<BarChart3 size={32} />}
          title="No equipment to roll up"
          description="Add equipment, set rates, log expenses, and capture truck-log hours to populate this report."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset tag</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Rate / hr</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">Purchase</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {computed.map((r) => (
                <TableRow key={r.item.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/equipment/${r.item.id}`} className="hover:underline">
                      {r.item.assetTag}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">{r.item.name}</TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-400">
                    {r.type?.name ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">{r.hours.toFixed(1)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(r.hourly)}</TableCell>
                  <TableCell className="text-right text-emerald-700 dark:text-emerald-400">
                    {fmtMoney(r.revenue)}
                  </TableCell>
                  <TableCell className="text-right text-amber-700 dark:text-amber-400">
                    {fmtMoney(r.expenses)}
                  </TableCell>
                  <TableCell className="text-right text-slate-600 dark:text-slate-400">
                    {fmtMoney(r.purchase)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-semibold ${
                      r.net >= 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-red-700 dark:text-red-400'
                    }`}
                  >
                    {fmtMoney(r.net)}
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
