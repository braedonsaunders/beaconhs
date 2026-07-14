import Link from 'next/link'
import { and, asc, count, desc, eq, ilike, isNull, or, type AnyColumn, type SQL } from 'drizzle-orm'
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
  people,
  tenantUsers,
  users as user,
} from '@beaconhs/db/schema'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { formatDate } from '@/lib/datetime'
import { ListPageLayout } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { SortableTh } from '@/components/sortable-th'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Equipment inspections' }

const BASE = '/equipment/inspections'
const SORTS = ['occurred', 'reference', 'equipment', 'type', 'result', 'status'] as const
type Sort = (typeof SORTS)[number]
const STATUSES = ['draft', 'in_progress', 'submitted', 'closed'] as const

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
  { value: 'closed', label: 'Closed' },
]

export default async function EquipmentInspectionsPage({
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
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.read.self')
  const canInspect = can(ctx, 'equipment.inspect')
  const rawStatus = pickString(sp.status) ?? ''
  const statusFilter = STATUSES.includes(rawStatus as (typeof STATUSES)[number]) ? rawStatus : ''

  const sortCol: Record<Sort, AnyColumn> = {
    occurred: equipmentInspectionRecords.occurredAt,
    reference: equipmentInspectionRecords.reference,
    equipment: equipmentItems.name,
    type: equipmentInspectionTypes.name,
    result: equipmentInspectionRecords.result,
    status: equipmentInspectionRecords.status,
  }
  const orderBy = params.dir === 'asc' ? asc(sortCol[params.sort]) : desc(sortCol[params.sort])
  const filters: SQL<unknown>[] = [
    eq(equipmentInspectionRecords.tenantId, ctx.tenantId),
    isNull(equipmentInspectionRecords.deletedAt),
  ]
  if (statusFilter) {
    filters.push(eq(equipmentInspectionRecords.status, statusFilter as (typeof STATUSES)[number]))
  }
  if (params.q) {
    const term = `%${params.q}%`
    const cond = or(
      ilike(equipmentInspectionRecords.reference, term),
      ilike(equipmentItems.name, term),
      ilike(equipmentItems.assetTag, term),
      ilike(equipmentInspectionTypes.name, term),
    )
    if (cond) filters.push(cond)
  }

  const { rows, total } = await ctx.db(async (tx) => {
    // Read-tier scope: all → everything; site → records at the caller's sites
    // (plus their own); self → only records they performed/submitted.
    const scope = await moduleScopeWhere(ctx, tx, {
      prefix: 'equipment',
      ownerCols: [
        equipmentInspectionRecords.inspectorTenantUserId,
        equipmentInspectionRecords.submittedByTenantUserId,
      ],
      siteCol: equipmentInspectionRecords.siteOrgUnitId,
      personCol: equipmentInspectionRecords.inspectorPersonId,
    })
    const where = and(...filters, ...(scope ? [scope] : []))
    const [tot] = await tx
      .select({ n: count() })
      .from(equipmentInspectionRecords)
      .leftJoin(
        equipmentItems,
        and(
          eq(equipmentItems.tenantId, equipmentInspectionRecords.tenantId),
          eq(equipmentItems.id, equipmentInspectionRecords.equipmentItemId),
        ),
      )
      .leftJoin(
        equipmentInspectionTypes,
        and(
          eq(equipmentInspectionTypes.tenantId, equipmentInspectionRecords.tenantId),
          eq(equipmentInspectionTypes.id, equipmentInspectionRecords.inspectionTypeId),
        ),
      )
      .where(where)
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
        inspectorUser: user.name,
        inspectorFirst: people.firstName,
        inspectorLast: people.lastName,
        inspectorText: equipmentInspectionRecords.inspectorText,
      })
      .from(equipmentInspectionRecords)
      .leftJoin(
        equipmentItems,
        and(
          eq(equipmentItems.tenantId, equipmentInspectionRecords.tenantId),
          eq(equipmentItems.id, equipmentInspectionRecords.equipmentItemId),
        ),
      )
      .leftJoin(
        equipmentInspectionTypes,
        and(
          eq(equipmentInspectionTypes.tenantId, equipmentInspectionRecords.tenantId),
          eq(equipmentInspectionTypes.id, equipmentInspectionRecords.inspectionTypeId),
        ),
      )
      .leftJoin(
        tenantUsers,
        and(
          eq(tenantUsers.tenantId, equipmentInspectionRecords.tenantId),
          eq(tenantUsers.id, equipmentInspectionRecords.inspectorTenantUserId),
        ),
      )
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .leftJoin(
        people,
        and(
          eq(people.tenantId, equipmentInspectionRecords.tenantId),
          eq(people.id, equipmentInspectionRecords.inspectorPersonId),
        ),
      )
      .where(where)
      .orderBy(orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    return { rows, total: Number(tot?.n ?? 0) }
  })

  const sortProps = { basePath: BASE, currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Inspections"
            description={`${total.toLocaleString()} record${total === 1 ? '' : 's'}`}
            actions={
              canInspect ? (
                <Link href="/equipment/inspections/new">
                  <Button>
                    <Plus size={14} /> New inspection
                  </Button>
                </Link>
              ) : undefined
            }
          />
          <EquipmentSubNav active="inspections" />
          <TableToolbar>
            <SearchInput placeholder="Search reference, equipment, type…" />
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
          </TableToolbar>
        </>
      }
    >
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
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
                  No inspections match this filter.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const inspector =
                  r.inspectorUser ??
                  ([r.inspectorFirst, r.inspectorLast].filter(Boolean).join(' ') || null) ??
                  r.inspectorText ??
                  null
                return (
                  <TableRow key={r.id}>
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
                        <div className="font-mono text-xs text-slate-500">{r.itemTag}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {r.typeName ?? '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                      {r.occurredAt ? formatDate(new Date(r.occurredAt), ctx.timezone) : '—'}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {inspector ?? '—'}
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
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination
        basePath={BASE}
        currentParams={sp}
        total={total}
        page={params.page}
        perPage={params.perPage}
      />

      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <ClipboardCheck size={12} /> Equipment inspections run from an inspection type&apos;s
        checklist. Configure types under Manage → Inspection types.
      </p>
    </ListPageLayout>
  )
}
