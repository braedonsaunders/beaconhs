import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { and, asc, count, desc, ilike, isNull, or, eq, type SQL } from 'drizzle-orm'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { documentCategories, documentTypes, documents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { createBlankDocument, listDocumentBooksForBulk } from './_actions'
import { DocumentsRecordsTable, type DocumentsTableRow } from './_records-table'
import { DocumentsSubNav } from './_components/documents-sub-nav'

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
  const params = parseListParams(sp, {
    sort: 'title',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const categoryFilter = pickString(sp.category)
  const typeFilter = pickString(sp.type)
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts, categoryCounts, typeCounts, categories, types } = await ctx.db(
    async (tx) => {
      const filters: SQL<unknown>[] = [isNull(documents.deletedAt)]
      if (params.q) {
        const term = `%${params.q}%`
        const cond = or(ilike(documents.title, term), ilike(documents.description, term))
        if (cond) filters.push(cond)
      }
      if (statusFilter) filters.push(eq(documents.status, statusFilter as any))
      if (categoryFilter) filters.push(eq(documents.categoryId, categoryFilter))
      if (typeFilter) filters.push(eq(documents.typeId, typeFilter))
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
      const live = isNull(documents.deletedAt)
      const ss = await tx
        .select({ s: documents.status, c: count() })
        .from(documents)
        .where(live)
        .groupBy(documents.status)
      const cc = await tx
        .select({ id: documents.categoryId, c: count() })
        .from(documents)
        .where(live)
        .groupBy(documents.categoryId)
      const tc = await tx
        .select({ id: documents.typeId, c: count() })
        .from(documents)
        .where(live)
        .groupBy(documents.typeId)
      const categories = await tx
        .select({ id: documentCategories.id, name: documentCategories.name })
        .from(documentCategories)
        .where(isNull(documentCategories.deletedAt))
        .orderBy(asc(documentCategories.name))
      const types = await tx
        .select({ id: documentTypes.id, name: documentTypes.name, color: documentTypes.color })
        .from(documentTypes)
        .where(isNull(documentTypes.deletedAt))
        .orderBy(asc(documentTypes.name))
      return {
        rows: data,
        total: Number(tot?.c ?? 0),
        statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
        categoryCounts: Object.fromEntries(
          cc.filter((x) => x.id).map((x) => [x.id as string, Number(x.c)]),
        ),
        typeCounts: Object.fromEntries(
          tc.filter((x) => x.id).map((x) => [x.id as string, Number(x.c)]),
        ),
        categories,
        types,
      }
    },
  )

  const books = await listDocumentBooksForBulk()
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const typeMap = new Map(types.map((t) => [t.id, t]))

  const tableRows: DocumentsTableRow[] = rows.map((d) => {
    const t = d.typeId ? typeMap.get(d.typeId) : null
    return {
      id: d.id,
      title: d.title,
      category: d.categoryId ? (catName.get(d.categoryId) ?? null) : d.category,
      type: t ? { name: t.name, color: t.color ?? null } : null,
      status: d.status,
      nextReviewOn: d.nextReviewOn,
    }
  })

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
                <form action={createBlankDocument}>
                  <Button type="submit">New document</Button>
                </form>
              </div>
            }
          />
          <DocumentsSubNav active="documents" />
          <TableToolbar>
            <SearchInput placeholder="Search title or description" />
            <FilterChips
              basePath="/documents"
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
            {categories.length > 0 ? (
              <FilterChips
                basePath="/documents"
                currentParams={sp}
                paramKey="category"
                label="Category"
                options={categories.map((c) => ({
                  value: c.id,
                  label: c.name,
                  count: categoryCounts[c.id],
                }))}
              />
            ) : null}
            {types.length > 0 ? (
              <FilterChips
                basePath="/documents"
                currentParams={sp}
                paramKey="type"
                label="Type"
                options={types.map((t) => ({
                  value: t.id,
                  label: t.name,
                  count: typeCounts[t.id],
                }))}
              />
            ) : null}
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={32} />}
          title={params.q || statusFilter ? 'No documents match these filters' : 'No documents'}
          description="Add policies, procedures, SDS sheets, manuals, and have workers acknowledge them."
          action={
            <form action={createBlankDocument}>
              <Button type="submit">New document</Button>
            </form>
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
