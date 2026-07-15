import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
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
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0620c94ba8d26d') }
}

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
  const tGenerated = await getGeneratedTranslations()
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
            title={tGenerated('m_189bb91aaf5565')}
            description={tGenerated('m_18faf7c048e1b2', {
              value0: total.toLocaleString(),
              value1: total === 1 ? '' : 's',
            })}
            actions={
              canInspect ? (
                <Link href="/equipment/inspections/new">
                  <Button>
                    <Plus size={14} /> <GeneratedText id="m_0f060bce7a52ef" />
                  </Button>
                </Link>
              ) : undefined
            }
          />
          <EquipmentSubNav active="inspections" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_17c97e2e4a7a11')} />
            <div className="flex flex-wrap items-center gap-1.5">
              <GeneratedValue
                value={STATUS_FILTERS.map((f) => {
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
                      <GeneratedValue value={f.label} />
                    </Link>
                  )
                })}
              />
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
                <GeneratedText id="m_17dc61a19b605c" />
              </SortableTh>
              <SortableTh {...sortProps} column="equipment" active={params.sort === 'equipment'}>
                <GeneratedText id="m_17f17df74f7e69" />
              </SortableTh>
              <SortableTh {...sortProps} column="type" active={params.sort === 'type'}>
                <GeneratedText id="m_074ba2f160c506" />
              </SortableTh>
              <SortableTh {...sortProps} column="occurred" active={params.sort === 'occurred'}>
                <GeneratedText id="m_16b944034f43b6" />
              </SortableTh>
              <TableHead>
                <GeneratedText id="m_08412ea75fe5da" />
              </TableHead>
              <SortableTh {...sortProps} column="result" active={params.sort === 'result'}>
                <GeneratedText id="m_100e41041dbe51" />
              </SortableTh>
              <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                <GeneratedText id="m_0b9da892d6faf0" />
              </SortableTh>
            </TableRow>
          </TableHeader>
          <TableBody>
            <GeneratedValue
              value={
                rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-500">
                      <GeneratedText id="m_1ef212a3b97a74" />
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
                            <GeneratedValue value={r.reference} />
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="text-slate-900 dark:text-slate-100">
                            <GeneratedValue value={r.itemName ?? '—'} />
                          </div>
                          <GeneratedValue
                            value={
                              r.itemTag ? (
                                <div className="font-mono text-xs text-slate-500">
                                  <GeneratedValue value={r.itemTag} />
                                </div>
                              ) : null
                            }
                          />
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300">
                          <GeneratedValue value={r.typeName ?? '—'} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                          <GeneratedValue
                            value={
                              r.occurredAt
                                ? formatDate(new Date(r.occurredAt), ctx.timezone, ctx.locale)
                                : '—'
                            }
                          />
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300">
                          <GeneratedValue value={inspector ?? '—'} />
                        </TableCell>
                        <TableCell>
                          <GeneratedValue
                            value={
                              r.result ? (
                                <Badge variant={RESULT_VARIANT[r.result] ?? 'secondary'}>
                                  <GeneratedValue value={r.result} />
                                </Badge>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[r.status] ?? 'secondary'}>
                            <GeneratedValue value={r.status.replace('_', ' ')} />
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )
              }
            />
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
        <ClipboardCheck size={12} /> <GeneratedText id="m_0235f132f871e4" />
      </p>
    </ListPageLayout>
  )
}
