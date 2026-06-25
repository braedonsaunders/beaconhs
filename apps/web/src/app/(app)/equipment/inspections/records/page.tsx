import Link from 'next/link'
import { asc, desc, eq, sql, type AnyColumn } from 'drizzle-orm'
import { ClipboardCheck, Plus } from 'lucide-react'
import {
  Badge,
  Button,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  equipmentInspectionRecords,
  equipmentInspectionTypes,
  equipmentItems,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { SortableTh } from '@/components/sortable-th'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Equipment inspections · BeaconHS' }

const BASE = '/equipment/inspections/records'
const SORTS = ['occurred', 'reference', 'equipment', 'type', 'result', 'status'] as const
type Sort = (typeof SORTS)[number]

const STATUS_VARIANT: Record<string, 'secondary' | 'warning' | 'success'> = {
  draft: 'secondary',
  in_progress: 'warning',
  submitted: 'success',
  closed: 'secondary',
}
const RESULT_VARIANT: Record<string, 'success' | 'destructive' | 'secondary'> = {
  pass: 'success',
  fail: 'destructive',
  incomplete: 'secondary',
}
const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
]

export default async function EquipmentInspectionsRecordsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams<Sort>(sp, {
    sort: 'occurred',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status) ?? ''
  const ctx = await requireRequestContext()

  const sortCol: Record<Sort, AnyColumn> = {
    occurred: equipmentInspectionRecords.occurredAt,
    reference: equipmentInspectionRecords.reference,
    equipment: equipmentItems.name,
    type: equipmentInspectionTypes.name,
    result: equipmentInspectionRecords.result,
    status: equipmentInspectionRecords.status,
  }
  const orderBy = params.dir === 'asc' ? asc(sortCol[params.sort]) : desc(sortCol[params.sort])
  const where = statusFilter
    ? eq(equipmentInspectionRecords.status, statusFilter as 'draft' | 'in_progress' | 'submitted')
    : undefined

  const { rows, total } = await ctx.db(async (tx) => {
    const countRows = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(equipmentInspectionRecords)
      .where(where)
    const totalCount = Number(countRows[0]?.n ?? 0)
    const rows = await tx
      .select({
        id: equipmentInspectionRecords.id,
        reference: equipmentInspectionRecords.reference,
        occurredAt: equipmentInspectionRecords.occurredAt,
        result: equipmentInspectionRecords.result,
        status: equipmentInspectionRecords.status,
        itemName: equipmentItems.name,
        itemTag: equipmentItems.assetTag,
        typeName: equipmentInspectionTypes.name,
        inspector: user.name,
      })
      .from(equipmentInspectionRecords)
      .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentInspectionRecords.equipmentItemId))
      .leftJoin(
        equipmentInspectionTypes,
        eq(equipmentInspectionTypes.id, equipmentInspectionRecords.inspectionTypeId),
      )
      .leftJoin(tenantUsers, eq(tenantUsers.id, equipmentInspectionRecords.inspectorTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(where)
      .orderBy(orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    return { rows, total: totalCount }
  })

  const pages = Math.max(1, Math.ceil(total / params.perPage))
  const from = total === 0 ? 0 : (params.page - 1) * params.perPage + 1
  const to = Math.min(params.page * params.perPage, total)
  const sortProps = { basePath: BASE, currentParams: sp, dir: params.dir }

  return (
    <PageContainer>
      <div className="space-y-4">
        <PageHeader
          title="Equipment inspections"
          description={`${total.toLocaleString()} record${total === 1 ? '' : 's'}`}
          actions={
            <Link href="/equipment/inspections/new">
              <Button>
                <Plus size={14} /> New inspection
              </Button>
            </Link>
          }
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((f) => {
            const active = statusFilter === f.value
            return (
              <Link
                key={f.value || 'all'}
                href={mergeHref(BASE, sp, { status: f.value || undefined, page: 1 }) as never}
                className={
                  active
                    ? 'rounded-full bg-teal-600 px-3 py-1 text-xs font-medium text-white'
                    : 'rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                }
              >
                {f.label}
              </Link>
            )
          })}
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="reference" active={params.sort === 'reference'}>
                  Reference
                </SortableTh>
                <SortableTh {...sortProps} column="equipment" active={params.sort === 'equipment'}>
                  Equipment
                </SortableTh>
                <SortableTh {...sortProps} column="type" active={params.sort === 'type'}>
                  Type
                </SortableTh>
                <SortableTh {...sortProps} column="occurred" active={params.sort === 'occurred'}>
                  Performed
                </SortableTh>
                <TableHead>Inspector</TableHead>
                <SortableTh {...sortProps} column="result" active={params.sort === 'result'}>
                  Result
                </SortableTh>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                  Status
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-500">
                    No inspections yet.{' '}
                    <Link href="/equipment/inspections/new" className="text-teal-600 hover:underline">
                      Start one
                    </Link>
                    .
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer">
                    <TableCell className="font-medium">
                      <Link
                        href={`/equipment/inspections/${r.id}`}
                        className="text-teal-700 hover:underline dark:text-teal-400"
                      >
                        {r.reference}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="text-slate-900 dark:text-slate-100">{r.itemName ?? '—'}</div>
                      {r.itemTag ? (
                        <div className="text-xs text-slate-500">{r.itemTag}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {r.typeName ?? '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {r.occurredAt ? new Date(r.occurredAt).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {r.inspector ?? '—'}
                    </TableCell>
                    <TableCell>
                      {r.result ? (
                        <Badge variant={RESULT_VARIANT[r.result] ?? 'secondary'}>{r.result}</Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status] ?? 'secondary'}>
                        {r.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {total > params.perPage ? (
          <div className="flex items-center justify-between text-sm text-slate-600 dark:text-slate-400">
            <span>
              {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              {params.page > 1 ? (
                <Link
                  href={mergeHref(BASE, sp, { page: params.page - 1 }) as never}
                  className="rounded-md border border-slate-200 px-3 py-1 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  Previous
                </Link>
              ) : null}
              <span className="text-xs text-slate-400">
                Page {params.page} of {pages}
              </span>
              {params.page < pages ? (
                <Link
                  href={mergeHref(BASE, sp, { page: params.page + 1 }) as never}
                  className="rounded-md border border-slate-200 px-3 py-1 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  Next
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <ClipboardCheck size={12} /> Equipment inspections run from an inspection type&apos;s
          checklist. Configure types under Manage → Inspection types.
        </p>
      </div>
    </PageContainer>
  )
}
