import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_14e667fd8661b7') }
}

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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
            title={tGenerated('m_14e667fd8661b7')}
            description={tGeneratedValue(
              canManage ? tGenerated('m_16fcfcfa6c96d6') : tGenerated('m_17ce63d85db80d'),
            )}
            actions={
              canManage ? (
                <form action={createBook}>
                  <Button type="submit">
                    <GeneratedText id="m_1fa9739f3f640f" />
                  </Button>
                </form>
              ) : null
            }
          />
          <DocumentsSubNav active="books" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_102da4ba6ceb5e')} />
            <GeneratedValue
              value={
                canManage ? (
                  <FilterChips
                    basePath="/documents/books"
                    currentParams={sp}
                    paramKey="status"
                    label={tGenerated('m_0b9da892d6faf0')}
                    options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
                  />
                ) : null
              }
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
                params.q || statusFilter
                  ? tGenerated('m_0c2848dc43a9ff')
                  : tGenerated('m_032fe9dc1cb03d'),
              )}
              description={tGeneratedValue(
                canManage ? tGenerated('m_0e46a3d2a9c1ef') : tGenerated('m_0a7f110f30576f'),
              )}
              action={
                canManage ? (
                  <form action={createBook}>
                    <Button type="submit">
                      <GeneratedText id="m_1fa9739f3f640f" />
                    </Button>
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
                      <GeneratedText id="m_0decefd558c355" />
                    </SortableTh>
                    <SortableTh
                      {...sortProps}
                      column="category"
                      active={params.sort === 'category'}
                    >
                      <GeneratedText id="m_108b41637f364f" />
                    </SortableTh>
                    <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                      <GeneratedText id="m_0b9da892d6faf0" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_05caa6a53f9b7f" />
                    </TableHead>
                    <SortableTh
                      {...sortProps}
                      column="updated_at"
                      active={params.sort === 'updated_at'}
                    >
                      <GeneratedText id="m_014ca61c68ab13" />
                    </SortableTh>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map((b) => {
                      const memberCount = memberCounts[b.id] ?? 0
                      const display = b.title || '(untitled)'
                      return (
                        <TableRow key={b.id}>
                          <TableCell>
                            <Link
                              href={`/documents/books/${b.id}`}
                              className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                            >
                              <GeneratedValue value={display} />
                            </Link>
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-300">
                            <GeneratedValue value={b.categoryName ?? '—'} />
                          </TableCell>
                          <TableCell>
                            <Badge variant={b.status === 'published' ? 'success' : 'secondary'}>
                              <GeneratedValue value={b.status} />
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              <GeneratedValue value={memberCount} />{' '}
                              <GeneratedValue
                                value={
                                  memberCount === 1 ? (
                                    <GeneratedText id="m_08927559ee23e3" />
                                  ) : (
                                    <GeneratedText id="m_0211a9acf0110a" />
                                  )
                                }
                              />
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-300">
                            <GeneratedValue
                              value={formatDate(new Date(b.updatedAt), ctx.timezone, ctx.locale)}
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  />
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
          )
        }
      />
    </ListPageLayout>
  )
}
