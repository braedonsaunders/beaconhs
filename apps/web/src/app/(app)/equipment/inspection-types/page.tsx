import Link from 'next/link'
import { ClipboardCheck } from 'lucide-react'
import { asc, count, eq } from 'drizzle-orm'
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
  equipmentInspectionCriteria,
  equipmentInspectionTypes,
  equipmentTypes,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { NewTypeDrawer, DeleteTypeButton } from './_drawers'

export const metadata = { title: 'Equipment inspection types' }
export const dynamic = 'force-dynamic'

export default async function InspectionTypesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const openNew = pickString(sp.drawer) === 'new'
  const ctx = await requireModuleManage('equipment')

  const { rows, types, counts } = await ctx.db(async (tx) => {
    const data = await tx
      .select({ t: equipmentInspectionTypes, applies: equipmentTypes })
      .from(equipmentInspectionTypes)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentInspectionTypes.appliesToTypeId))
      .orderBy(asc(equipmentInspectionTypes.name))
    const types = await tx
      .select({ id: equipmentTypes.id, name: equipmentTypes.name })
      .from(equipmentTypes)
      .orderBy(asc(equipmentTypes.name))
    const tally = await tx
      .select({ inspectionTypeId: equipmentInspectionCriteria.inspectionTypeId, c: count() })
      .from(equipmentInspectionCriteria)
      .groupBy(equipmentInspectionCriteria.inspectionTypeId)
    return {
      rows: data,
      types,
      counts: Object.fromEntries(tally.map((x) => [x.inspectionTypeId, Number(x.c)])),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Inspection types"
            description="Pass/fail inspection templates shared by equipment type."
            actions={
              <Link href="/equipment/inspection-types?drawer=new" scroll={false}>
                <Button>New inspection type</Button>
              </Link>
            }
          />
          <EquipmentSubNav active="inspection-types" />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title="No inspection types"
          description="Create a type, then add pass/fail criteria from its detail page."
          action={
            <Link href="/equipment/inspection-types?drawer=new" scroll={false}>
              <Button>New inspection type</Button>
            </Link>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Applies to type</TableHead>
                <TableHead>Interval</TableHead>
                <TableHead className="text-right">Criteria</TableHead>
                <TableHead>Auto-WO on fail</TableHead>
                <TableHead>Pass-all</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ t, applies }) => {
                const n = counts[t.id] ?? 0
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <Link
                        href={`/equipment/inspection-types/${t.id}`}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {t.name}
                      </Link>
                      {t.description ? (
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {t.description}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">
                      {applies?.name ?? <span className="text-slate-400 italic">any</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{t.interval.replace('_', ' ')}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={n > 0 ? 'success' : 'warning'}>{n}</Badge>
                    </TableCell>
                    <TableCell>
                      {t.failsSpawnWorkOrders ? (
                        <Badge variant="success">Yes</Badge>
                      ) : (
                        <Badge variant="secondary">No</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {t.allowPassAll ? (
                        <Badge variant="success">Yes</Badge>
                      ) : (
                        <Badge variant="secondary">No</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <DeleteTypeButton id={t.id} name={t.name} />
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <NewTypeDrawer open={openNew} closeHref="/equipment/inspection-types" types={types} />
    </ListPageLayout>
  )
}
