import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, count, desc, ilike, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import { Gavel } from 'lucide-react'
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
import { documentManagementReviewDocuments, documentManagementReviews } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { parseListParams, pickString } from '@/lib/list-params'
import { DocumentsSubNav } from '../_components/documents-sub-nav'
import { createManagementReview } from './[id]/actions'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0058e514601039') }
}
export const dynamic = 'force-dynamic'

const BASE = '/documents/management-reviews'
const SORTS = ['title', 'periodEnd', 'nextReview'] as const

export default async function ManagementReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const nextParam = pickString(sp.next)
  const nextFilter =
    nextParam === 'scheduled' || nextParam === 'unscheduled' ? nextParam : undefined
  const params = parseListParams(sp, {
    sort: 'periodEnd',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const ctx = await requireRequestContext()
  // Board-level discussion notes and decisions are a manage-only surface —
  // every write action and the nav entry require documents.manage, and there
  // is no read-only audience today.
  if (!can(ctx, 'documents.manage')) notFound()
  const { rows, total, scheduledCount, unscheduledCount } = await ctx.db(async (tx) => {
    const active = isNull(documentManagementReviews.deletedAt)
    const search: SQL<unknown> | undefined = params.q
      ? ilike(documentManagementReviews.title, `%${params.q}%`)
      : undefined
    const next =
      nextFilter === 'scheduled'
        ? isNotNull(documentManagementReviews.nextReviewOn)
        : nextFilter === 'unscheduled'
          ? isNull(documentManagementReviews.nextReviewOn)
          : undefined
    const where = and(active, search, next)
    const dirFn = params.dir === 'asc' ? asc : desc
    const orderBy =
      params.sort === 'title'
        ? [dirFn(documentManagementReviews.title)]
        : params.sort === 'nextReview'
          ? [
              dirFn(documentManagementReviews.nextReviewOn),
              desc(documentManagementReviews.periodEnd),
            ]
          : [dirFn(documentManagementReviews.periodEnd)]

    const [totalRow, scheduledRow, unscheduledRow, result] = await Promise.all([
      tx.select({ c: count() }).from(documentManagementReviews).where(where),
      tx
        .select({ c: count() })
        .from(documentManagementReviews)
        .where(and(active, search, isNotNull(documentManagementReviews.nextReviewOn))),
      tx
        .select({ c: count() })
        .from(documentManagementReviews)
        .where(and(active, search, isNull(documentManagementReviews.nextReviewOn))),
      tx
        .select({
          review: documentManagementReviews,
          documentsReviewedCount: sql<number>`(
            select count(*)::int
            from ${documentManagementReviewDocuments}
            where ${documentManagementReviewDocuments.tenantId} = ${documentManagementReviews.tenantId}
              and ${documentManagementReviewDocuments.managementReviewId} = ${documentManagementReviews.id}
          )`,
        })
        .from(documentManagementReviews)
        .where(where)
        .orderBy(...orderBy)
        .limit(params.perPage)
        .offset((params.page - 1) * params.perPage),
    ])
    return {
      rows: result.map((row) => ({
        ...row.review,
        documentsReviewedCount: row.documentsReviewedCount,
      })),
      total: Number(totalRow[0]?.c ?? 0),
      scheduledCount: Number(scheduledRow[0]?.c ?? 0),
      unscheduledCount: Number(unscheduledRow[0]?.c ?? 0),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_0058e514601039')}
            description={tGenerated('m_0352b530b59edf')}
            actions={
              <form action={createManagementReview}>
                <Button type="submit">
                  <GeneratedText id="m_114bc7cb55d176" />
                </Button>
              </form>
            }
          />
          <DocumentsSubNav active="management-reviews" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_1da98bce8ac2b3')} />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="next"
              label={tGenerated('m_146d385340eb4f')}
              options={[
                { value: 'scheduled', label: 'Scheduled', count: scheduledCount },
                { value: 'unscheduled', label: 'Not scheduled', count: unscheduledCount },
              ]}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<Gavel size={32} />}
              title={tGeneratedValue(
                !params.q && !nextFilter
                  ? tGenerated('m_05945a401c1db6')
                  : tGenerated('m_13aa20f29a803c'),
              )}
              description={tGeneratedValue(
                !params.q && !nextFilter
                  ? tGenerated('m_085d5da668c6d8')
                  : tGenerated('m_083e0275050c11'),
              )}
              action={
                !params.q && !nextFilter ? (
                  <form action={createManagementReview}>
                    <Button type="submit">
                      <GeneratedText id="m_0d3b5ce69d3a29" />
                    </Button>
                  </form>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh
                      basePath={BASE}
                      currentParams={sp}
                      dir={params.dir}
                      column="title"
                      active={params.sort === 'title'}
                    >
                      <GeneratedText id="m_0decefd558c355" />
                    </SortableTh>
                    <SortableTh
                      basePath={BASE}
                      currentParams={sp}
                      dir={params.dir}
                      column="periodEnd"
                      active={params.sort === 'periodEnd'}
                    >
                      <GeneratedText id="m_1ec8c0e767ebe2" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_09720d00a25962" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_1e8c4796a4ec7d" />
                    </TableHead>
                    <SortableTh
                      basePath={BASE}
                      currentParams={sp}
                      dir={params.dir}
                      column="nextReview"
                      active={params.sort === 'nextReview'}
                    >
                      <GeneratedText id="m_146d385340eb4f" />
                    </SortableTh>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Link
                            href={`/documents/management-reviews/${r.id}`}
                            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                          >
                            <GeneratedValue value={r.title} />
                          </Link>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300">
                          <GeneratedValue value={r.periodStart ? `${r.periodStart} → ` : ''} />
                          <GeneratedValue value={r.periodEnd} />
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            <GeneratedValue value={r.participants.length} />
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            <GeneratedValue value={r.documentsReviewedCount} />
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300">
                          <GeneratedValue value={r.nextReviewOn ?? '—'} />
                        </TableCell>
                      </TableRow>
                    ))}
                  />
                </TableBody>
              </Table>
            </div>
          )
        }
      />
      <Pagination
        basePath={BASE}
        currentParams={sp}
        total={total}
        page={params.page}
        perPage={params.perPage}
      />
    </ListPageLayout>
  )
}
