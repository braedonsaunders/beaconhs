import Link from 'next/link'
import { count, desc, eq, sql } from 'drizzle-orm'
import { ClipboardCheck } from 'lucide-react'
import {
  Badge,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { equipmentItems, formResponses, formTemplates, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { clamp, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'

export const metadata = { title: 'Equipment inspections' }
export const dynamic = 'force-dynamic'

export default async function EquipmentInspectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const page = clamp(Number(pickString(sp.page) ?? '1'), 1, 10_000)
  const perPage = 25
  const ctx = await requireRequestContext()

  // Submitted equipment inspections only, newest first.
  const where = sql`${formResponses.sourceEntityType} = 'equipment'
      AND (${formTemplates.moduleBinding} = 'equipment_inspection'
           OR ${formTemplates.category} = 'inspection')
      AND ${formResponses.submittedAt} IS NOT NULL`

  const { rows, total } = await ctx.db(async (tx) => {
    const [tot] = await tx
      .select({ c: count() })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .where(where)
    const data = await tx
      .select({
        response: formResponses,
        template: formTemplates,
        item: equipmentItems,
        site: orgUnits,
      })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .leftJoin(equipmentItems, eq(equipmentItems.id, formResponses.sourceEntityId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
      .where(where)
      .orderBy(desc(formResponses.submittedAt))
      .limit(perPage)
      .offset((page - 1) * perPage)
    return { rows: data, total: Number(tot?.c ?? 0) }
  })

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="inspections" />
          <PageHeader
            title="Inspections"
            description="Completed equipment inspections, most recent first."
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title="No completed inspections"
          description="Equipment inspections appear here once they're submitted."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template</TableHead>
                  <TableHead>Equipment</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ response, template, item, site }) => (
                  <TableRow key={response.id}>
                    <TableCell className="font-medium">{template.name}</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">
                      {item ? (
                        <Link href={`/equipment/${item.id}`} className="hover:underline">
                          <span className="font-mono text-xs">{item.assetTag}</span> · {item.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">
                      {site?.name ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          response.status === 'closed' || response.status === 'submitted'
                            ? 'success'
                            : 'warning'
                        }
                      >
                        {response.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-600 tabular-nums dark:text-slate-400">
                      {response.submittedAt ? new Date(response.submittedAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/apps/responses/${response.id}`}
                        className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                      >
                        View →
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {total > perPage ? (
            <Pagination
              basePath="/equipment/inspections"
              currentParams={sp}
              total={total}
              page={page}
              perPage={perPage}
            />
          ) : null}
        </>
      )}
    </ListPageLayout>
  )
}
