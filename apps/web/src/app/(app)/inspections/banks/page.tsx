import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { ClipboardList } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, sql, type SQL } from 'drizzle-orm'
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
import { inspectionBankCriteria, inspectionBanks } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { InspectionsSubNav } from '../_sub-nav'
import { InspectionBanksDrawers } from './_drawers'

export const metadata = { title: 'Inspection Banks' }

async function createBankAction(input: {
  name: string
  description: string | null
  category: string | null
  isPublished: boolean
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'inspections')
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required' }
  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .insert(inspectionBanks)
      .values({
        tenantId: ctx.tenantId,
        name,
        description: input.description,
        category: input.category,
        isPublished: input.isPublished,
        createdBy: ctx.userId,
      })
      .returning()
    return r
  })
  if (!row) return { ok: false, error: 'Failed to create bank' }
  await recordAudit(ctx, {
    entityType: 'inspection_bank',
    entityId: row.id,
    action: 'create',
    summary: `Created bank "${name}"`,
    after: { name, category: input.category, isPublished: input.isPublished },
  })
  revalidatePath('/inspections/banks')
  return { ok: true, id: row.id }
}

const SORTS = ['name', 'category', 'created_at', 'status'] as const

const STATUS_OPTIONS = [
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
]

export default async function InspectionBanksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const ctx = await requireModuleManage('inspections')

  const { rows, total, statusCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = ilike(inspectionBanks.name, term)
      if (cond) filters.push(cond)
    }
    if (statusFilter === 'published') filters.push(eq(inspectionBanks.isPublished, true))
    if (statusFilter === 'draft') filters.push(eq(inspectionBanks.isPublished, false))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'category'
        ? [params.dir === 'asc' ? asc(inspectionBanks.category) : desc(inspectionBanks.category)]
        : params.sort === 'created_at'
          ? [
              params.dir === 'asc'
                ? asc(inspectionBanks.createdAt)
                : desc(inspectionBanks.createdAt),
            ]
          : params.sort === 'status'
            ? [
                params.dir === 'asc'
                  ? asc(inspectionBanks.isPublished)
                  : desc(inspectionBanks.isPublished),
              ]
            : [params.dir === 'asc' ? asc(inspectionBanks.name) : desc(inspectionBanks.name)]

    const [tot] = await tx.select({ c: count() }).from(inspectionBanks).where(whereClause)

    const data = await tx
      .select({
        bank: inspectionBanks,
        criteriaCount: sql<number>`count(${inspectionBankCriteria.id})`.mapWith(Number),
      })
      .from(inspectionBanks)
      .leftJoin(inspectionBankCriteria, eq(inspectionBankCriteria.bankId, inspectionBanks.id))
      .where(whereClause)
      .groupBy(inspectionBanks.id)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const ss = await tx
      .select({ p: inspectionBanks.isPublished, c: count() })
      .from(inspectionBanks)
      .groupBy(inspectionBanks.isPublished)
    const sc: Record<string, number> = {}
    for (const r of ss) {
      sc[r.p ? 'published' : 'draft'] = Number(r.c)
    }

    return { rows: data, total: Number(tot?.c ?? 0), statusCounts: sc }
  })

  const sortProps = { basePath: '/inspections/banks', currentParams: sp, dir: params.dir }
  const openDrawer = pickString(sp.drawer) === 'new-bank' ? 'new-bank' : null

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Inspection Banks"
            description="Reusable criteria templates — drop one into a new inspection to skip rewriting the question list every time."
            actions={
              <Link href="/inspections/banks?drawer=new-bank" scroll={false}>
                <Button>New bank</Button>
              </Link>
            }
          />
          <InspectionsSubNav active="banks" />
          <TableToolbar>
            <SearchInput placeholder="Search by bank name" />
            <FilterChips
              basePath="/inspections/banks"
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={32} />}
          title={params.q ? `No banks match "${params.q}"` : 'No inspection banks'}
          description="Create a bank, add criteria, and reuse it across inspections."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                  Name
                </SortableTh>
                <SortableTh {...sortProps} column="category" active={params.sort === 'category'}>
                  Category
                </SortableTh>
                <TableHead>Criteria</TableHead>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                  Status
                </SortableTh>
                <SortableTh
                  {...sortProps}
                  column="created_at"
                  active={params.sort === 'created_at'}
                >
                  Created
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ bank, criteriaCount }) => (
                <TableRow key={bank.id}>
                  <TableCell>
                    <Link
                      href={`/inspections/banks/${bank.id}`}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {bank.name}
                    </Link>
                    {bank.description ? (
                      <div className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                        {bank.description}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-400">
                    {bank.category ? bank.category.replace(/_/g, ' ') : '—'}
                  </TableCell>
                  <TableCell className="text-slate-600 tabular-nums dark:text-slate-400">
                    {criteriaCount}
                  </TableCell>
                  <TableCell>
                    <Badge variant={bank.isPublished ? 'success' : 'secondary'}>
                      {bank.isPublished ? 'Published' : 'Draft'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-400">
                    {formatDate(new Date(bank.createdAt), ctx.timezone, ctx.locale)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/inspections/banks"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
      <InspectionBanksDrawers
        openDrawer={openDrawer}
        closeHref="/inspections/banks"
        createBankAction={createBankAction}
      />
    </ListPageLayout>
  )
}
