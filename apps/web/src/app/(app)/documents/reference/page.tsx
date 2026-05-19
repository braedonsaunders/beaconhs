import Link from 'next/link'
import { ExternalLink, FileText, FlaskConical, Library } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
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
import { documentReferences } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'

export const metadata = { title: 'Reference library' }

const SORTS = ['title', 'category', 'kind', 'updated_at'] as const

const CATEGORY_OPTIONS = [
  { value: 'sds', label: 'SDS / MSDS' },
  { value: 'manual', label: 'Manual' },
  { value: 'external', label: 'External link' },
  { value: 'standard', label: 'Standard / regulation' },
  { value: 'other', label: 'Other' },
]

export default async function DocumentReferencesPage({
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
  const categoryFilter = pickString(sp.category)
  const ctx = await requireRequestContext()

  const { rows, total, categoryCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(documentReferences.title, term),
        ilike(documentReferences.description, term),
      )
      if (cond) filters.push(cond)
    }
    if (categoryFilter) filters.push(eq(documentReferences.category, categoryFilter))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'category'
        ? [
            params.dir === 'asc'
              ? asc(documentReferences.category)
              : desc(documentReferences.category),
          ]
        : params.sort === 'kind'
          ? [params.dir === 'asc' ? asc(documentReferences.kind) : desc(documentReferences.kind)]
          : params.sort === 'updated_at'
            ? [
                params.dir === 'asc'
                  ? asc(documentReferences.updatedAt)
                  : desc(documentReferences.updatedAt),
              ]
            : [params.dir === 'asc' ? asc(documentReferences.title) : desc(documentReferences.title)]

    const [tot] = await tx.select({ c: count() }).from(documentReferences).where(whereClause)
    const data = await tx
      .select()
      .from(documentReferences)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const cc = await tx
      .select({ s: documentReferences.category, c: count() })
      .from(documentReferences)
      .groupBy(documentReferences.category)
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      categoryCounts: Object.fromEntries(cc.map((x) => [x.s ?? 'other', Number(x.c)])),
    }
  })

  const sortProps = { basePath: '/documents/reference', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Reference library"
            description="Pointers to external material — SDS sheets, equipment manuals, standards, vendor docs. Lightweight; no versioning or acknowledgments."
            actions={
              <Link href="/documents/reference/new">
                <Button>New reference</Button>
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
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
            >
              Books
            </Link>
            <Link
              href="/documents/reference"
              className="rounded-full border border-teal-500 bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700"
            >
              Reference library
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search title or description" />
          </div>
          <FilterChips
            basePath="/documents/reference"
            currentParams={sp}
            paramKey="category"
            label="Category"
            options={CATEGORY_OPTIONS.map((o) => ({ ...o, count: categoryCounts[o.value] }))}
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Library size={32} />}
          title={
            params.q || categoryFilter ? 'No references match these filters' : 'No references yet'
          }
          description="Add SDS sheets, equipment manuals, vendor docs, or external links your team needs quick access to."
          action={
            <Link href="/documents/reference/new">
              <Button>Add your first reference</Button>
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
                <SortableTh {...sortProps} column="kind" active={params.sort === 'kind'}>
                  Kind
                </SortableTh>
                <TableHead>Target</TableHead>
                <SortableTh {...sortProps} column="updated_at" active={params.sort === 'updated_at'}>
                  Updated
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link
                      href={`/documents/reference/${r.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {r.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {r.category ? (
                      <Badge variant="outline">{r.category}</Badge>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.kind === 'url' ? (
                      <Badge variant="secondary">
                        <ExternalLink size={10} className="mr-1" /> URL
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        <FileText size={10} className="mr-1" /> File
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-slate-500">
                    {r.kind === 'url' ? r.url : r.attachmentId ? 'Uploaded file' : '—'}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {new Date(r.updatedAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/documents/reference"
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
