import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { and, asc, count, desc, ilike, isNull, or, eq, type SQL } from 'drizzle-orm'
import {
  Button,
  EmptyState,
  PageHeader,
} from '@beaconhs/ui'
import { documents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { listDocumentBooksForBulk } from './_actions'
import { DocumentsRecordsTable, type DocumentsTableRow } from './_records-table'

export const metadata = { title: 'Documents' }

const SORTS = ['title', 'category', 'status', 'next_review_on'] as const

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
  { value: 'under_review', label: 'Under review' },
]

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, { sort: 'title', dir: 'asc', perPage: 25, allowedSorts: SORTS })
  const statusFilter = pickString(sp.status)
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [isNull(documents.deletedAt)]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(documents.title, term), ilike(documents.description, term))
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(documents.status, statusFilter as any))
    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'category'
        ? [params.dir === 'asc' ? asc(documents.category) : desc(documents.category)]
        : params.sort === 'status'
          ? [params.dir === 'asc' ? asc(documents.status) : desc(documents.status)]
          : params.sort === 'next_review_on'
            ? [params.dir === 'asc' ? asc(documents.nextReviewOn) : desc(documents.nextReviewOn)]
            : [params.dir === 'asc' ? asc(documents.title) : desc(documents.title)]

    const [tot] = await tx.select({ c: count() }).from(documents).where(whereClause)
    const data = await tx
      .select()
      .from(documents)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const ss = await tx
      .select({ s: documents.status, c: count() })
      .from(documents)
      .groupBy(documents.status)
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
    }
  })

  const books = await listDocumentBooksForBulk()

  const tableRows: DocumentsTableRow[] = rows.map((d) => ({
    id: d.id,
    title: d.title,
    category: d.category,
    status: d.status,
    nextReviewOn: d.nextReviewOn,
  }))

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Documents"
            description="Versioned library + read-and-acknowledge + periodic review + management review books."
            actions={
              <div className="flex items-center gap-2">
                <Link href={buildExportHref('/documents/export.csv', sp)}>
                  <Button variant="outline">Export CSV</Button>
                </Link>
                <Link href="/documents/new">
                  <Button>New document</Button>
                </Link>
              </div>
            }
          />
          <nav className="flex flex-wrap items-center gap-2">
            <Link
              href="/documents"
              className="rounded-full border border-teal-500 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700"
            >
              Documents
            </Link>
            <Link
              href="/documents/books"
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
            >
              Books
            </Link>
            <Link
              href="/documents/reference"
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
            >
              Reference library
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search title or description" />
          </div>
          <FilterChips
            basePath="/documents"
            currentParams={sp}
            paramKey="status"
            label="Status"
            options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={32} />}
          title={params.q || statusFilter ? 'No documents match these filters' : 'No documents yet'}
          description="Add policies, procedures, SDS sheets, manuals, and have workers acknowledge them."
          action={
            <Link href="/documents/new">
              <Button>Create your first document</Button>
            </Link>
          }
        />
      ) : (
        <>
          <DocumentsRecordsTable rows={tableRows} books={books} />
          <Pagination
            basePath="/documents"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
    </ListPageLayout>
  )
}
