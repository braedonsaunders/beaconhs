import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_17d1f0b9fab4d0') }
}
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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
            title={tGenerated('m_17d1f0b9fab4d0')}
            description={tGenerated('m_03bf7faae069d6')}
            actions={
              <Link href="/ppe/banks?drawer=new-bank" scroll={false}>
                <Button>
                  <GeneratedText id="m_0b211bf8765d07" />
                </Button>
              </Link>
            }
          />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_0a377ecaa4554e')} />
            <FilterChips
              basePath="/ppe/banks"
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<Library size={32} />}
              title={tGeneratedValue(
                params.q
                  ? tGenerated('m_1f2f294558529d', { value0: params.q })
                  : tGenerated('m_04d25c096f1bd0'),
              )}
              description={tGenerated('m_1b0b8146b73a97')}
              action={
                <Link href="/ppe/banks?drawer=new-bank" scroll={false}>
                  <Button>
                    <GeneratedText id="m_0b211bf8765d07" />
                  </Button>
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
                        <GeneratedText id="m_02b18d5c7f6f2d" />
                      </SortableTh>
                      <SortableTh
                        {...sortProps}
                        column="category"
                        active={params.sort === 'category'}
                      >
                        <GeneratedText id="m_108b41637f364f" />
                      </SortableTh>
                      <TableHead>
                        <GeneratedText id="m_1a1ce62686f0b8" />
                      </TableHead>
                      <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                        <GeneratedText id="m_0b9da892d6faf0" />
                      </SortableTh>
                      <SortableTh
                        {...sortProps}
                        column="created_at"
                        active={params.sort === 'created_at'}
                      >
                        <GeneratedText id="m_10cbe051fb5e05" />
                      </SortableTh>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <GeneratedValue
                      value={rows.map(({ bank, criteriaCount }) => (
                        <TableRow key={bank.id}>
                          <TableCell>
                            <Link
                              href={`/ppe/banks/${bank.id}`}
                              className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                            >
                              <GeneratedValue value={bank.name} />
                            </Link>
                            <GeneratedValue
                              value={
                                bank.description ? (
                                  <div className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                                    <GeneratedValue value={bank.description} />
                                  </div>
                                ) : null
                              }
                            />
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">
                            <GeneratedValue
                              value={bank.category ? bank.category.replace(/_/g, ' ') : '—'}
                            />
                          </TableCell>
                          <TableCell className="text-slate-600 tabular-nums dark:text-slate-400">
                            <GeneratedValue value={criteriaCount} />
                          </TableCell>
                          <TableCell>
                            <Badge variant={bank.isPublished ? 'success' : 'secondary'}>
                              <GeneratedValue
                                value={
                                  bank.isPublished ? (
                                    <GeneratedText id="m_0a65097103ae1b" />
                                  ) : (
                                    <GeneratedText id="m_13f3db1d0ca2fe" />
                                  )
                                }
                              />
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">
                            <GeneratedValue
                              value={formatDate(new Date(bank.createdAt), ctx.timezone, ctx.locale)}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    />
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
          )
        }
      />
      <PpeBanksDrawers
        openDrawer={openDrawer}
        closeHref="/ppe/banks"
        createBankAction={createBankAction}
      />
    </ListPageLayout>
  )
}
