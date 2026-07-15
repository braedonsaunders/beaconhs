import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_02f6f730a215f8') }
}

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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
            title={tGenerated('m_02f6f730a215f8')}
            description={tGenerated('m_04be8588e33dcb')}
            actions={
              <Link href="/inspections/banks?drawer=new-bank" scroll={false}>
                <Button>
                  <GeneratedText id="m_0b211bf8765d07" />
                </Button>
              </Link>
            }
          />
          <InspectionsSubNav active="banks" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_0a377ecaa4554e')} />
            <FilterChips
              basePath="/inspections/banks"
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
              icon={<ClipboardList size={32} />}
              title={tGeneratedValue(
                params.q
                  ? tGenerated('m_1f2f294558529d', { value0: params.q })
                  : tGenerated('m_03e7e4dfa0e6a6'),
              )}
              description={tGenerated('m_0f68850100d67a')}
            />
          ) : (
            <>
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
                            href={`/inspections/banks/${bank.id}`}
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
              <Pagination
                basePath="/inspections/banks"
                currentParams={sp}
                total={total}
                page={params.page}
                perPage={params.perPage}
              />
            </>
          )
        }
      />
      <InspectionBanksDrawers
        openDrawer={openDrawer}
        closeHref="/inspections/banks"
        createBankAction={createBankAction}
      />
    </ListPageLayout>
  )
}
