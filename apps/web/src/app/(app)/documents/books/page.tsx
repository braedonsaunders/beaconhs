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
import { can } from '@beaconhs/tenant'
import { documentBookItems, documentBooks, documentCategories } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { DocumentsSubNav } from '../_components/documents-sub-nav'
import { ReadOnlyBooksGrid } from './_read-only-books-grid'
import { createBook } from './[id]/actions'

export const metadata = { title: 'Document books' }

const SORTS = ['title', 'category', 'status', 'updated_at'] as const

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
] as const
type BookStatus = (typeof STATUS_OPTIONS)[number]['value']

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
  // Validate the status param before it hits the enum cast — a crafted value
  // is ignored rather than 500ing the page.
  const statusRaw = pickString(sp.status)
  const statusFilter = STATUS_OPTIONS.some((o) => o.value === statusRaw)
    ? (statusRaw as BookStatus)
    : undefined
  const ctx = await requireRequestContext()
  const canManage = ctx.isSuperAdmin || can(ctx, 'documents.manage')

  const { rows, total, statusCounts, memberCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (!canManage) filters.push(eq(documentBooks.status, 'published'))
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(documentBooks.title, term), ilike(documentBooks.description, term))
      if (cond) filters.push(cond)
    }
    if (canManage && statusFilter) filters.push(eq(documentBooks.status, statusFilter))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'category'
        ? [params.dir === 'asc' ? asc(documentCategories.name) : desc(documentCategories.name)]
        : params.sort === 'status'
          ? [params.dir === 'asc' ? asc(documentBooks.status) : desc(documentBooks.status)]
          : params.sort === 'updated_at'
            ? [params.dir === 'asc' ? asc(documentBooks.updatedAt) : desc(documentBooks.updatedAt)]
            : [params.dir === 'asc' ? asc(documentBooks.title) : desc(documentBooks.title)]

    const [tot] = await tx.select({ c: count() }).from(documentBooks).where(whereClause)
    const data = await tx
      .select({ book: documentBooks, categoryName: documentCategories.name })
      .from(documentBooks)
      .leftJoin(documentCategories, eq(documentCategories.id, documentBooks.categoryId))
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
                data.map((r) => sql`${r.book.id}::uuid`),
                sql`, `,
              )})`,
            )
            .groupBy(documentBookItems.bookId)
    return {
      rows: data.map(({ book, categoryName }) => ({ ...book, categoryName })),
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
      memberCounts: Object.fromEntries(mc.map((x) => [x.bookId, Number(x.c)])),
    }
  })

  const bookCards = rows.map((b) => ({
    id: b.id,
    title: b.title || '(untitled)',
    description: b.description,
    category: b.categoryName,
    documentCount: memberCounts[b.id] ?? 0,
  }))

  const sortProps = { basePath: '/documents/books', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Document books"
            description={
              canManage
                ? 'Curated, ordered bundles of documents that publish as a single PDF — perfect for management review packs.'
                : 'Read complete document packs — each book opens as a single PDF.'
            }
            actions={
              canManage ? (
                <form action={createBook}>
                  <Button type="submit">New book</Button>
                </form>
              ) : null
            }
          />
          <DocumentsSubNav active="books" />
          <TableToolbar>
            <SearchInput placeholder="Search title or description" />
            {canManage ? (
              <FilterChips
                basePath="/documents/books"
                currentParams={sp}
                paramKey="status"
                label="Status"
                options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
              />
            ) : null}
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Library size={32} />}
          title={params.q || statusFilter ? 'No books match these filters' : 'No books'}
          description={
            canManage
              ? 'Create a book to bundle related documents into a single management-review PDF.'
              : 'No published books are available to read yet.'
          }
          action={
            canManage ? (
              <form action={createBook}>
                <Button type="submit">New book</Button>
              </form>
            ) : undefined
          }
        />
      ) : !canManage ? (
        <>
          <ReadOnlyBooksGrid books={bookCards} />
          <Pagination
            basePath="/documents/books"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
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
                <SortableTh
                  {...sortProps}
                  column="updated_at"
                  active={params.sort === 'updated_at'}
                >
                  Updated
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => {
                const memberCount = memberCounts[b.id] ?? 0
                const display = b.title || '(untitled)'
                return (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link
                        href={`/documents/books/${b.id}`}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {display}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {b.categoryName ?? '—'}
                    </TableCell>
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
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {formatDate(new Date(b.updatedAt), ctx.timezone)}
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
