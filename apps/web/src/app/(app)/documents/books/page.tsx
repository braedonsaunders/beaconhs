import Link from 'next/link'
import { Library } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
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
import { documentBookItems, documentBooks } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'

export const metadata = { title: 'Document books' }

const SORTS = ['title', 'category', 'status', 'updated_at'] as const

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
]

export default async function DocumentBooksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'title',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts, memberCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(documentBooks.title, term), ilike(documentBooks.description, term))
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(documentBooks.status, statusFilter as any))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'category'
        ? [params.dir === 'asc' ? asc(documentBooks.category) : desc(documentBooks.category)]
        : params.sort === 'status'
          ? [params.dir === 'asc' ? asc(documentBooks.status) : desc(documentBooks.status)]
          : params.sort === 'updated_at'
            ? [params.dir === 'asc' ? asc(documentBooks.updatedAt) : desc(documentBooks.updatedAt)]
            : [params.dir === 'asc' ? asc(documentBooks.title) : desc(documentBooks.title)]

    const [tot] = await tx.select({ c: count() }).from(documentBooks).where(whereClause)
    const data = await tx
      .select()
      .from(documentBooks)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const ss = await tx
      .select({ s: documentBooks.status, c: count() })
      .from(documentBooks)
      .groupBy(documentBooks.status)
    const mc =
      data.length === 0
        ? []
        : await tx
            .select({ bookId: documentBookItems.bookId, c: count() })
            .from(documentBookItems)
            .where(
              sql`${documentBookItems.bookId} IN (${sql.join(
                data.map((r) => sql`${r.id}::uuid`),
                sql`, `,
              )})`,
            )
            .groupBy(documentBookItems.bookId)
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
      memberCounts: Object.fromEntries(mc.map((x) => [x.bookId, Number(x.c)])),
    }
  })

  const sortProps = { basePath: '/documents/books', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Document books"
            description="Curated, ordered bundles of documents that publish as a single PDF — perfect for management review packs."
            actions={
              <Link href="/documents/books/new">
                <Button>New book</Button>
              </Link>
            }
          />
          <nav className="flex flex-wrap items-center gap-2">
            <Link
              href="/documents"
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
            >
              Documents
            </Link>
            <Link
              href="/documents/books"
              className="rounded-full border border-teal-500 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700"
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
            basePath="/documents/books"
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
          icon={<Library size={32} />}
          title={params.q || statusFilter ? 'No books match these filters' : 'No books yet'}
          description="Create a book to bundle related documents into a single management-review PDF."
          action={
            <Link href="/documents/books/new">
              <Button>Create your first book</Button>
            </Link>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="title" active={params.sort === 'title'}>
                  Title
                </SortableTh>
                <SortableTh {...sortProps} column="category" active={params.sort === 'category'}>
                  Category
                </SortableTh>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                  Status
                </SortableTh>
                <TableHead>Documents</TableHead>
                <SortableTh {...sortProps} column="updated_at" active={params.sort === 'updated_at'}>
                  Updated
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => {
                const memberCount = memberCounts[b.id] ?? 0
                const display = b.title || b.name || '(untitled)'
                return (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link
                        href={`/documents/books/${b.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {display}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600">{b.category ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={b.status === 'published' ? 'success' : 'secondary'}>
                        {b.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {memberCount} {memberCount === 1 ? 'document' : 'documents'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {new Date(b.updatedAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            basePath="/documents/books"
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
