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

export const metadata = { title: 'Management reviews' }
export const dynamic = 'force-dynamic'

const BASE = '/documents/management-reviews'
const SORTS = ['title', 'periodEnd', 'nextReview'] as const

export default async function ManagementReviewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
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
            title="Management reviews"
            description="Annual / scheduled board reviews of the SH&S management system — discussion notes, decisions, follow-up actions and next-review dates."
            actions={
              <form action={createManagementReview}>
                <Button type="submit">New review</Button>
              </form>
            }
          />
          <DocumentsSubNav active="management-reviews" />
          <TableToolbar>
            <SearchInput placeholder="Search review titles…" />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="next"
              label="Next review"
              options={[
                { value: 'scheduled', label: 'Scheduled', count: scheduledCount },
                { value: 'unscheduled', label: 'Not scheduled', count: unscheduledCount },
              ]}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Gavel size={32} />}
          title={
            !params.q && !nextFilter ? 'No management reviews recorded' : 'No matching reviews'
          }
          description={
            !params.q && !nextFilter
              ? 'Capture each annual / quarterly board review of the SH&S system — the documents covered, decisions made, and follow-up actions.'
              : 'Adjust the search or next-review filter.'
          }
          action={
            !params.q && !nextFilter ? (
              <form action={createManagementReview}>
                <Button type="submit">Record first review</Button>
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
                  Title
                </SortableTh>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  dir={params.dir}
                  column="periodEnd"
                  active={params.sort === 'periodEnd'}
                >
                  Period
                </SortableTh>
                <TableHead>Participants</TableHead>
                <TableHead>Documents reviewed</TableHead>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  dir={params.dir}
                  column="nextReview"
                  active={params.sort === 'nextReview'}
                >
                  Next review
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link
                      href={`/documents/management-reviews/${r.id}`}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {r.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-300">
                    {r.periodStart ? `${r.periodStart} → ` : ''}
                    {r.periodEnd}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.participants.length}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{r.documentsReviewedCount}</Badge>
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-300">
                    {r.nextReviewOn ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
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
