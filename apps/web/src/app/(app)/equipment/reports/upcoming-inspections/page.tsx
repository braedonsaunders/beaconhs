import Link from 'next/link'
import { AlertTriangle, CalendarCheck } from 'lucide-react'
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
  equipmentItems,
  equipmentTypes,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'

export const metadata = { title: 'Upcoming inspections' }
export const dynamic = 'force-dynamic'

function isoDateAhead(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default async function UpcomingInspections({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const days = Number(pickString(sp.days) ?? '30')
  const horizon = isoDateAhead(Number.isFinite(days) ? Math.max(1, Math.min(180, days)) : 30)
  const ctx = await requireRequestContext()

  const rows = await ctx.db((tx) =>
    tx
      .select({
        item: equipmentItems,
        type: equipmentTypes,
        site: orgUnits,
        holder: people,
      })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
      .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
      .where(
        sql`${equipmentItems.requiresAnnualInspection} = true AND (
          ${equipmentItems.nextAnnualInspectionDue} IS NULL OR
          ${equipmentItems.nextAnnualInspectionDue} <= ${horizon}::date
        )`,
      )
      .orderBy(asc(equipmentItems.nextAnnualInspectionDue)),
  )

  const today = new Date().toISOString().slice(0, 10)
  const overdueCount = rows.filter(
    (r) => r.item.nextAnnualInspectionDue !== null && r.item.nextAnnualInspectionDue < today,
  ).length

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="reports" />
          <PageHeader
            title="Upcoming inspections"
            description={`Equipment with annual inspections due in the next ${days} days, plus everything currently overdue.`}
            back={{ href: '/equipment/reports', label: 'Back to reports' }}
            actions={
              <Link
                href={buildExportHref('/equipment/reports/upcoming-inspections/export.csv', sp)}
              >
                <Button variant="outline">Export CSV</Button>
              </Link>
            }
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge variant="destructive">{overdueCount} overdue</Badge>
            <Badge variant="secondary">{rows.length - overdueCount} due soon</Badge>
            <form className="ml-auto flex items-center gap-2">
              <label className="text-xs text-slate-600">Horizon (days)</label>
              <input
                type="number"
                name="days"
                min={1}
                max={180}
                defaultValue={days}
                className="h-8 w-20 rounded border border-slate-200 px-2 text-sm"
              />
              <Button type="submit" variant="outline" size="sm">
                Apply
              </Button>
            </form>
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck size={32} />}
          title="Nothing due in the next 30 days"
          description="The fleet is clean — no annual inspections are coming up in this window."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset tag</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Holder</TableHead>
                <TableHead>Last annual</TableHead>
                <TableHead>Next due</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ item, type, site, holder }) => {
                const overdue =
                  item.nextAnnualInspectionDue !== null &&
                  item.nextAnnualInspectionDue < today
                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/equipment/${item.id}`} className="hover:underline">
                        {item.assetTag}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell className="text-slate-600">{type?.name ?? '—'}</TableCell>
                    <TableCell className="text-slate-600">{site?.name ?? '—'}</TableCell>
                    <TableCell className="text-slate-600">
                      {holder ? `${holder.firstName} ${holder.lastName}` : '—'}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {item.lastAnnualInspectionOn ?? '—'}
                    </TableCell>
                    <TableCell className={overdue ? 'text-red-700 font-medium' : 'text-slate-700'}>
                      {item.nextAnnualInspectionDue ?? 'unscheduled'}
                      {overdue ? (
                        <Badge variant="destructive" className="ml-2">
                          <AlertTriangle size={10} className="mr-1" /> overdue
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/forms?category=inspection&sourceEntityType=equipment&sourceEntityId=${item.id}`}
                        className="text-xs text-teal-700 hover:underline"
                      >
                        Start →
                      </Link>
                    </TableCell>
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
