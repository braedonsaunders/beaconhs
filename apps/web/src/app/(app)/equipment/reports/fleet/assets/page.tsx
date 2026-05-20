import Link from 'next/link'
import { Truck } from 'lucide-react'
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
  equipmentTypes,
  orgUnits,
  people,
  truckLogEntries,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'

export const metadata = { title: 'Fleet report — assets' }
export const dynamic = 'force-dynamic'

function fmtMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(n)
}

export default async function FleetAssetsReport() {
  const ctx = await requireRequestContext()
  const yearStart = new Date()
  yearStart.setMonth(0, 1)
  yearStart.setHours(0, 0, 0, 0)
  const yearStartIso = yearStart.toISOString().slice(0, 10)

  const rows = await ctx.db(async (tx) => {
    return tx
      .select({
        item: equipmentItems,
        type: equipmentTypes,
        site: orgUnits,
        holder: people,
        hoursYtd: sql<string>`(
          SELECT COALESCE(SUM(${truckLogEntries.hoursOnSite})::text, '0')
          FROM truck_log_entries
          WHERE truck_log_entries.equipment_item_id = ${equipmentItems.id}
            AND truck_log_entries.entry_date >= ${yearStartIso}
        )`,
        kmYtd: sql<string>`(
          SELECT COALESCE(SUM(${truckLogEntries.kmDriven})::text, '0')
          FROM truck_log_entries
          WHERE truck_log_entries.equipment_item_id = ${equipmentItems.id}
            AND truck_log_entries.entry_date >= ${yearStartIso}
        )`,
        expensesYtd: sql<string>`(
          SELECT COALESCE(SUM(${equipmentExpenses.amount})::text, '0')
          FROM equipment_expenses
          WHERE equipment_expenses.equipment_item_id = ${equipmentItems.id}
            AND equipment_expenses.incurred_on >= ${yearStartIso}
        )`,
      })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
      .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
      .orderBy(asc(equipmentItems.assetTag))
  })

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="reports" />
          <PageHeader
            title="Fleet — all assets"
            description={`All ${rows.length} assets in the register. Hours, km, and expenses are year-to-date.`}
            back={{ href: '/equipment/reports/fleet', label: 'Back to fleet summary' }}
            actions={
              <Link href={buildExportHref('/equipment/reports/fleet/export.csv', {})}>
                <Button variant="outline">Export CSV</Button>
              </Link>
            }
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Truck size={32} />}
          title="No equipment in register"
          description="Add equipment to populate the fleet report."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset tag</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Current site</TableHead>
                <TableHead>Holder</TableHead>
                <TableHead className="text-right">Hours YTD</TableHead>
                <TableHead className="text-right">Km YTD</TableHead>
                <TableHead className="text-right">Expenses YTD</TableHead>
                <TableHead>Last inspection</TableHead>
                <TableHead>Next due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ item, type, site, holder, hoursYtd, kmYtd, expensesYtd }) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/equipment/${item.id}`} className="hover:underline">
                      {item.assetTag}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="text-slate-600">{type?.name ?? '—'}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        item.status === 'in_service'
                          ? 'success'
                          : item.status === 'retired'
                            ? 'secondary'
                            : 'warning'
                      }
                    >
                      {item.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">{site?.name ?? '—'}</TableCell>
                  <TableCell className="text-slate-600">
                    {holder ? `${holder.firstName} ${holder.lastName}` : '—'}
                  </TableCell>
                  <TableCell className="text-right">{Number(hoursYtd).toFixed(1)}</TableCell>
                  <TableCell className="text-right">{Number(kmYtd).toLocaleString()}</TableCell>
                  <TableCell className="text-right">{fmtMoney(expensesYtd)}</TableCell>
                  <TableCell className="text-slate-600">
                    {item.lastAnnualInspectionOn ?? '—'}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {item.nextAnnualInspectionDue ?? '—'}
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
