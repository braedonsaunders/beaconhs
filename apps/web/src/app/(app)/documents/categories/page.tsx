import { alias } from 'drizzle-orm/pg-core'
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  isNotNull,
  isNull,
  not,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { FolderTree, Trash2 } from 'lucide-react'
import Link from 'next/link'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@beaconhs/ui'
import { documentCategories, documents } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { ListPageLayout } from '@/components/page-layout'
import { ConfirmButton } from '@/components/confirm-button'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { DocumentsSubNav } from '../_components/documents-sub-nav'
import { createCategory, deleteCategory, updateCategory } from './_actions'
import { CategoryParentPicker } from './_parent-picker'

export const metadata = { title: 'Document categories' }
export const dynamic = 'force-dynamic'

const BASE = '/documents/categories'
const SORTS = ['name', 'parent', 'usage'] as const

export default async function DocumentCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const hierarchyParam = pickString(sp.hierarchy)
  const hierarchyFilter =
    hierarchyParam === 'top' || hierarchyParam === 'nested' ? hierarchyParam : undefined
  const usageParam = pickString(sp.usage)
  const usageFilter = usageParam === 'used' || usageParam === 'unused' ? usageParam : undefined
  const categoryError = pickString(sp.categoryError)
  const returnTo = mergeHref(BASE, sp, { categoryError: undefined })
  const ctx = await requireModuleManage('documents')
  const parent = alias(documentCategories, 'document_category_parent')

  const { rows, total, page, counts, initialParentOptions } = await ctx.db(async (tx) => {
    const active = isNull(documentCategories.deletedAt)
    const search: SQL<unknown> | undefined = params.q
      ? or(
          ilike(documentCategories.name, `%${params.q}%`),
          ilike(documentCategories.description, `%${params.q}%`),
          ilike(parent.name, `%${params.q}%`),
        )
      : undefined
    const hasDocuments = exists(
      tx
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.categoryId, documentCategories.id), isNull(documents.deletedAt))),
    )
    const hierarchy =
      hierarchyFilter === 'top'
        ? isNull(documentCategories.parentId)
        : hierarchyFilter === 'nested'
          ? isNotNull(documentCategories.parentId)
          : undefined
    const usage =
      usageFilter === 'used'
        ? hasDocuments
        : usageFilter === 'unused'
          ? not(hasDocuments)
          : undefined
    const where = and(active, search, hierarchy, usage)
    const usageCount = sql<number>`(
      select count(*)
      from ${documents}
      where ${documents.categoryId} = ${documentCategories.id}
        and ${documents.deletedAt} is null
    )`

    const [totalRow, tallyRow, parentOptions] = await Promise.all([
      tx
        .select({ c: count() })
        .from(documentCategories)
        .leftJoin(parent, eq(parent.id, documentCategories.parentId))
        .where(where),
      tx
        .select({
          top: sql<number>`count(*) filter (where ${documentCategories.parentId} is null)`,
          nested: sql<number>`count(*) filter (where ${documentCategories.parentId} is not null)`,
          used: sql<number>`count(*) filter (where ${hasDocuments})`,
          unused: sql<number>`count(*) filter (where not (${hasDocuments}))`,
        })
        .from(documentCategories)
        .leftJoin(parent, eq(parent.id, documentCategories.parentId))
        .where(and(active, search)),
      tx
        .select({ id: documentCategories.id, name: documentCategories.name })
        .from(documentCategories)
        .where(active)
        .orderBy(asc(documentCategories.name), asc(documentCategories.id))
        .limit(25),
    ])

    const total = Number(totalRow[0]?.c ?? 0)
    const lastPage = Math.max(1, Math.ceil(total / params.perPage))
    const page = Math.min(params.page, lastPage)
    const dir = params.dir === 'asc' ? asc : desc
    const orderBy =
      params.sort === 'parent'
        ? [dir(parent.name), asc(documentCategories.name), asc(documentCategories.id)]
        : params.sort === 'usage'
          ? [dir(usageCount), asc(documentCategories.name), asc(documentCategories.id)]
          : [dir(documentCategories.name), asc(documentCategories.id)]

    const data = await tx
      .select({
        id: documentCategories.id,
        name: documentCategories.name,
        description: documentCategories.description,
        parentId: documentCategories.parentId,
        parentName: parent.name,
        usageCount,
      })
      .from(documentCategories)
      .leftJoin(parent, eq(parent.id, documentCategories.parentId))
      .where(where)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((page - 1) * params.perPage)

    return {
      rows: data,
      total,
      page,
      counts: {
        top: Number(tallyRow[0]?.top ?? 0),
        nested: Number(tallyRow[0]?.nested ?? 0),
        used: Number(tallyRow[0]?.used ?? 0),
        unused: Number(tallyRow[0]?.unused ?? 0),
      },
      initialParentOptions: parentOptions,
    }
  })

  const sortProps = { basePath: BASE, currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Document categories"
            description="Hierarchical groupings for documents. Pick a parent to nest one category beneath another."
          />
          <DocumentsSubNav active="categories" />
          <TableToolbar>
            <SearchInput placeholder="Search name, description, parent…" />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="hierarchy"
              label="Level"
              allLabel="All levels"
              options={[
                { value: 'top', label: 'Top level', count: counts.top },
                { value: 'nested', label: 'Nested', count: counts.nested },
              ]}
            />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="usage"
              label="Usage"
              options={[
                { value: 'used', label: 'Used', count: counts.used },
                { value: 'unused', label: 'Unused', count: counts.unused },
              ]}
            />
          </TableToolbar>
          {categoryError ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              <span>{categoryError}</span>
              <Link href={returnTo as never} className="shrink-0 font-medium underline">
                Dismiss
              </Link>
            </div>
          ) : null}
        </>
      }
    >
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Create a new category</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createCategory} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input type="hidden" name="returnTo" value={returnTo} />
              <div className="space-y-1.5">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" name="name" required placeholder="e.g. Safety / SDS / Acids" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-category-parent">Parent (optional)</Label>
                <CategoryParentPicker
                  id="new-category-parent"
                  current={null}
                  initialOptions={initialParentOptions}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" name="description" rows={2} />
              </div>
              <div className="flex justify-end sm:col-span-2">
                <Button type="submit">Add category</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {total === 0 ? (
          <EmptyState
            icon={<FolderTree size={32} />}
            title={params.q ? `No categories match "${params.q}"` : 'No categories'}
            description={
              params.q || hierarchyFilter || usageFilter
                ? 'Clear or change the current search and filters.'
                : 'Add categories like Safety, HR, Operations and nest sub-categories underneath each.'
            }
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Categories ({total.toLocaleString()})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                      Name
                    </SortableTh>
                    <SortableTh {...sortProps} column="parent" active={params.sort === 'parent'}>
                      Parent
                    </SortableTh>
                    <TableHead>Description</TableHead>
                    <SortableTh {...sortProps} column="usage" active={params.sort === 'usage'}>
                      Used by
                    </SortableTh>
                    <TableHead aria-label="Actions" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const formId = `category-${row.id}`
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <form id={formId} action={updateCategory}>
                            <input type="hidden" name="id" value={row.id} />
                            <input type="hidden" name="returnTo" value={returnTo} />
                            <Input
                              name="name"
                              defaultValue={row.name}
                              required
                              aria-label={`Name for ${row.name}`}
                              className="min-w-44"
                            />
                          </form>
                        </TableCell>
                        <TableCell>
                          <CategoryParentPicker
                            key={`${row.id}:${row.parentId ?? 'root'}`}
                            current={
                              row.parentId && row.parentName
                                ? { id: row.parentId, name: row.parentName }
                                : null
                            }
                            initialOptions={initialParentOptions}
                            excludeId={row.id}
                            form={formId}
                            ariaLabel={`Parent category for ${row.name}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            name="description"
                            defaultValue={row.description ?? ''}
                            placeholder="Description"
                            aria-label={`Description for ${row.name}`}
                            form={formId}
                            className="min-w-52"
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant={Number(row.usageCount) > 0 ? 'secondary' : 'outline'}>
                            {Number(row.usageCount).toLocaleString()}{' '}
                            {Number(row.usageCount) === 1 ? 'document' : 'documents'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button type="submit" form={formId} size="sm" variant="outline">
                              Save
                            </Button>
                            <form action={deleteCategory}>
                              <input type="hidden" name="id" value={row.id} />
                              <input type="hidden" name="returnTo" value={returnTo} />
                              <ConfirmButton
                                type="submit"
                                variant="ghost"
                                size="sm"
                                aria-label={`Delete ${row.name}`}
                                message={`Delete ${row.name}? Its child categories will move up one level.`}
                                tone="danger"
                              >
                                <Trash2 size={14} className="text-red-500" />
                              </ConfirmButton>
                            </form>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <Pagination
                basePath={BASE}
                currentParams={sp}
                total={total}
                page={page}
                perPage={params.perPage}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </ListPageLayout>
  )
}
