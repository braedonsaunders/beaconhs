import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { Library } from 'lucide-react'
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
import { ppeCriteriaBankCriteria, ppeCriteriaBanks } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { assertCanManageModule, requireModuleManage } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { PpeSubNav } from '@/components/ppe-sub-nav'
import { PpeBanksDrawers } from './_drawers'

export const metadata = { title: 'PPE criteria banks' }
export const dynamic = 'force-dynamic'

async function createBankAction(input: {
  name: string
  description: string | null
  category: string | null
  isPublished: boolean
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'ppe')
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required' }
  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .insert(ppeCriteriaBanks)
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
    entityType: 'ppe_criteria_bank',
    entityId: row.id,
    action: 'create',
    summary: `Created criteria bank "${name}"`,
    after: { name, category: input.category, isPublished: input.isPublished },
  })
  revalidatePath('/ppe/banks')
  return { ok: true, id: row.id }
}

const SORTS = ['name', 'category', 'created_at', 'status'] as const

const STATUS_OPTIONS = [
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Draft' },
]

export default async function PpeBanksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, { sort: 'name', dir: 'asc', perPage: 25, allowedSorts: SORTS })
  const statusFilter = pickString(sp.status)
  const ctx = await requireModuleManage('ppe')

  const { rows, total, statusCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const cond = ilike(ppeCriteriaBanks.name, `%${params.q}%`)
      if (cond) filters.push(cond)
    }
    if (statusFilter === 'published') filters.push(eq(ppeCriteriaBanks.isPublished, true))
    if (statusFilter === 'draft') filters.push(eq(ppeCriteriaBanks.isPublished, false))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'category'
        ? [params.dir === 'asc' ? asc(ppeCriteriaBanks.category) : desc(ppeCriteriaBanks.category)]
        : params.sort === 'created_at'
          ? [
              params.dir === 'asc'
                ? asc(ppeCriteriaBanks.createdAt)
                : desc(ppeCriteriaBanks.createdAt),
            ]
          : params.sort === 'status'
            ? [
                params.dir === 'asc'
                  ? asc(ppeCriteriaBanks.isPublished)
                  : desc(ppeCriteriaBanks.isPublished),
              ]
            : [params.dir === 'asc' ? asc(ppeCriteriaBanks.name) : desc(ppeCriteriaBanks.name)]

    const [tot] = await tx.select({ c: count() }).from(ppeCriteriaBanks).where(whereClause)

    const data = await tx
      .select({
        bank: ppeCriteriaBanks,
        criteriaCount: sql<number>`count(${ppeCriteriaBankCriteria.id})`.mapWith(Number),
      })
      .from(ppeCriteriaBanks)
      .leftJoin(ppeCriteriaBankCriteria, eq(ppeCriteriaBankCriteria.bankId, ppeCriteriaBanks.id))
      .where(whereClause)
      .groupBy(ppeCriteriaBanks.id)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const ss = await tx
      .select({ p: ppeCriteriaBanks.isPublished, c: count() })
      .from(ppeCriteriaBanks)
      .groupBy(ppeCriteriaBanks.isPublished)
    const sc: Record<string, number> = {}
    for (const r of ss) sc[r.p ? 'published' : 'draft'] = Number(r.c)

    return { rows: data, total: Number(tot?.c ?? 0), statusCounts: sc }
  })

  const sortProps = { basePath: '/ppe/banks', currentParams: sp, dir: params.dir }
  const openDrawer = pickString(sp.drawer) === 'new-bank' ? 'new-bank' : null

  return (
    <ListPageLayout
      header={
        <>
          <PpeSubNav active="banks" />
          <PageHeader
            title="PPE criteria banks"
            description="Reusable, severity-aware criteria templates — drop one into a PPE type as a section instead of rewriting the checklist."
            actions={
              <Link href="/ppe/banks?drawer=new-bank" scroll={false}>
                <Button>New bank</Button>
              </Link>
            }
          />
          <TableToolbar>
            <SearchInput placeholder="Search by bank name" />
            <FilterChips
              basePath="/ppe/banks"
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
          icon={<Library size={32} />}
          title={params.q ? `No banks match "${params.q}"` : 'No criteria banks'}
          description="Create a bank, add criteria, and reuse it across PPE types."
          action={
            <Link href="/ppe/banks?drawer=new-bank" scroll={false}>
              <Button>New bank</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
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
                        href={`/ppe/banks/${bank.id}`}
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
          </div>
          <Pagination
            basePath="/ppe/banks"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
      <PpeBanksDrawers
        openDrawer={openDrawer}
        closeHref="/ppe/banks"
        createBankAction={createBankAction}
      />
    </ListPageLayout>
  )
}
