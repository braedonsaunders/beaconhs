import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { and, asc, count, desc, ilike, or, eq, type SQL } from 'drizzle-orm'
import {
  Badge,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { documents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'

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
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(documents.title, term), ilike(documents.description, term))
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(documents.status, statusFilter as any))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

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

  const sortProps = { basePath: '/documents', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Documents"
            description="Versioned library + read-and-acknowledge + periodic review + management review books."
          />
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
        <EmptyState icon={<BookOpen size={32} />} title="No documents match" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="title" active={params.sort === 'title'}>Title</SortableTh>
                <SortableTh {...sortProps} column="category" active={params.sort === 'category'}>Category</SortableTh>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>Status</SortableTh>
                <SortableTh {...sortProps} column="next_review_on" active={params.sort === 'next_review_on'}>Next review</SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link href={`/documents/${d.id}`} className="font-medium text-slate-900 hover:underline">
                      {d.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600">{d.category ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={d.status === 'published' ? 'success' : 'secondary'}>{d.status}</Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">{d.nextReviewOn ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
