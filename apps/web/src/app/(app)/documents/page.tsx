import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { notFound } from 'next/navigation'
import { BookOpen } from 'lucide-react'
import { and, asc, count, desc, ilike, isNull, or, eq, type SQL } from 'drizzle-orm'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { documentCategories, documentTypes, documents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref, isUuid, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { createDocument, listDocumentBooksForBulk } from './_actions'
import { DocumentsRecordsTable, type DocumentsTableRow } from './_records-table'
import { DocumentsSubNav } from './_components/documents-sub-nav'
import { ReadOnlyDocumentsGrid, type ReadOnlyDoc } from './_read-only-grid'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_05caa6a53f9b7f') }
}

const SORTS = ['title', 'category', 'status', 'next_review_on'] as const

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
  { value: 'under_review', label: 'Under review' },
] as const
type DocumentStatus = (typeof STATUS_OPTIONS)[number]['value']

export default async function DocumentsPage({
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
  // Validate query-string filters before they hit enum/uuid casts — a crafted
  // value is ignored rather than 500ing the page.
  const statusRaw = pickString(sp.status)
  const statusFilter = STATUS_OPTIONS.some((o) => o.value === statusRaw)
    ? (statusRaw as DocumentStatus)
    : undefined
  const categoryRaw = pickString(sp.category)
  const categoryFilter = categoryRaw && isUuid(categoryRaw) ? categoryRaw : undefined
  const typeRaw = pickString(sp.type)
  const typeFilter = typeRaw && isUuid(typeRaw) ? typeRaw : undefined
  const ctx = await requireRequestContext()
  // Administration + Health & Safety (documents.manage) get the management table;
  // documents.read holders get a read-only card library of published documents.
  // Mirrors the detail page so users without any documents permission see nothing.
  const canManage = ctx.isSuperAdmin || can(ctx, 'documents.manage')
  if (!canManage && !can(ctx, 'documents.read')) notFound()
  const canExport = canManage && can(ctx, 'admin.data.export')

  const { rows, total, statusCounts, categoryCounts, typeCounts, categories, types } = await ctx.db(
    async (tx) => {
      const filters: SQL<unknown>[] = [isNull(documents.deletedAt)]
      if (!canManage) filters.push(eq(documents.status, 'published'))
      if (params.q) {
        const term = `%${params.q}%`
        const cond = or(ilike(documents.title, term), ilike(documents.description, term))
        if (cond) filters.push(cond)
      }
      if (canManage && statusFilter) filters.push(eq(documents.status, statusFilter))
      if (categoryFilter) filters.push(eq(documents.categoryId, categoryFilter))
      if (typeFilter) filters.push(eq(documents.typeId, typeFilter))
      const whereClause = and(...filters)

      const orderBy =
        params.sort === 'category'
          ? [params.dir === 'asc' ? asc(documentCategories.name) : desc(documentCategories.name)]
          : params.sort === 'status'
            ? [params.dir === 'asc' ? asc(documents.status) : desc(documents.status)]
            : params.sort === 'next_review_on'
              ? [params.dir === 'asc' ? asc(documents.nextReviewOn) : desc(documents.nextReviewOn)]
              : [params.dir === 'asc' ? asc(documents.title) : desc(documents.title)]

      const [tot] = await tx.select({ c: count() }).from(documents).where(whereClause)
      const data = await tx
        .select({ document: documents, categoryName: documentCategories.name })
        .from(documents)
        .leftJoin(documentCategories, eq(documentCategories.id, documents.categoryId))
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
  const typeMap = new Map(types.map((t) => [t.id, t]))

  const tableRows: DocumentsTableRow[] = rows.map(({ document: d, categoryName }) => {
    const t = d.typeId ? typeMap.get(d.typeId) : null
    return {
      id: d.id,
      title: d.title,
      category: categoryName,
      type: t ? { name: t.name, color: t.color ?? null } : null,
      status: d.status,
      nextReviewOn: d.nextReviewOn,
    }
  })

  const cardRows: ReadOnlyDoc[] = rows.map(({ document: d, categoryName }) => {
    const t = d.typeId ? typeMap.get(d.typeId) : null
    return {
      id: d.id,
      title: d.title,
      description: d.description,
      category: categoryName,
      type: t ? { name: t.name, color: t.color ?? null } : null,
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_05caa6a53f9b7f')}
            description={tGeneratedValue(
              canManage ? tGenerated('m_05cf23dffd3ef9') : tGenerated('m_0d0196d47f960b'),
            )}
            actions={
              canManage ? (
                <div className="flex items-center gap-2">
                  <GeneratedValue
                    value={
                      canExport ? (
                        <a href={buildExportHref('/documents/export.csv', sp)}>
                          <Button variant="outline">
                            <GeneratedText id="m_14c6440eca1edc" />
                          </Button>
                        </a>
                      ) : null
                    }
                  />
                  <form action={createDocument}>
                    <Button type="submit">
                      <GeneratedText id="m_1c03b1cfc3b5e4" />
                    </Button>
                  </form>
                </div>
              ) : null
            }
          />
          <DocumentsSubNav active="documents" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_102da4ba6ceb5e')} />
            <GeneratedValue
              value={
                canManage ? (
                  <FilterChips
                    basePath="/documents"
                    currentParams={sp}
                    paramKey="status"
                    label={tGenerated('m_0b9da892d6faf0')}
                    options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
                  />
                ) : null
              }
            />
            <GeneratedValue
              value={
                categories.length > 0 ? (
                  <FilterChips
                    basePath="/documents"
                    currentParams={sp}
                    paramKey="category"
                    label={tGenerated('m_108b41637f364f')}
                    options={categories.map((c) => ({
                      value: c.id,
                      label: c.name,
                      count: categoryCounts[c.id],
                    }))}
                  />
                ) : null
              }
            />
            <GeneratedValue
              value={
                types.length > 0 ? (
                  <FilterChips
                    basePath="/documents"
                    currentParams={sp}
                    paramKey="type"
                    label={tGenerated('m_074ba2f160c506')}
                    options={types.map((t) => ({
                      value: t.id,
                      label: t.name,
                      count: typeCounts[t.id],
                    }))}
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
              icon={<BookOpen size={32} />}
              title={tGeneratedValue(
                params.q || statusFilter
                  ? tGenerated('m_0ad1bb032430fb')
                  : tGenerated('m_19c5708340fc91'),
              )}
              description={tGeneratedValue(
                canManage ? tGenerated('m_198902f0fd9668') : tGenerated('m_11fef320398fe5'),
              )}
              action={
                canManage ? (
                  <form action={createDocument}>
                    <Button type="submit">
                      <GeneratedText id="m_1c03b1cfc3b5e4" />
                    </Button>
                  </form>
                ) : undefined
              }
            />
          ) : (
            <>
              <GeneratedValue
                value={
                  canManage ? (
                    <DocumentsRecordsTable
                      rows={tableRows}
                      books={books}
                      basePath="/documents"
                      currentParams={sp}
                      sort={params.sort}
                      dir={params.dir}
                    />
                  ) : (
                    <ReadOnlyDocumentsGrid docs={cardRows} />
                  )
                }
              />
              <Pagination
                basePath="/documents"
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
