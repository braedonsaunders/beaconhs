import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { Plus, Tags, Trash2 } from 'lucide-react'
import { asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
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
import { equipmentCategories, equipmentTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { EquipmentCategoryDrawer, type CategoryEditing } from './_drawers'

export const metadata = { title: 'Equipment categories' }
export const dynamic = 'force-dynamic'

const BASE = '/equipment/categories'
const SORTS = ['name', 'slug', 'order'] as const

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function saveCategory(input: {
  id?: string
  name: string
  description: string | null
  sortOrder: number
}): Promise<{ ok: true } | { ok: false; error: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'equipment')
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required' }
  const id = await ctx.db(async (tx) => {
    if (input.id) {
      await tx
        .update(equipmentCategories)
        .set({ name, description: input.description, sortOrder: input.sortOrder })
        .where(eq(equipmentCategories.id, input.id))
      return input.id
    }
    const [row] = await tx
      .insert(equipmentCategories)
      .values({
        tenantId: ctx.tenantId,
        name,
        slug: slugify(name),
        description: input.description,
        sortOrder: input.sortOrder,
      })
      .onConflictDoNothing({ target: [equipmentCategories.tenantId, equipmentCategories.slug] })
      .returning({ id: equipmentCategories.id })
    return row?.id
  })
  if (!id)
    return {
      ok: false,
      error: input.id ? 'Failed to save category' : 'A category with that name already exists',
    }
  await recordAudit(ctx, {
    entityType: 'equipment_category',
    entityId: id,
    action: input.id ? 'update' : 'create',
    summary: `${input.id ? 'Updated' : 'Created'} equipment category "${name}"`,
  })
  revalidatePath(BASE)
  return { ok: true }
}

async function deleteCategory(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'equipment')
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return
  await ctx.db((tx) => tx.delete(equipmentCategories).where(eq(equipmentCategories.id, id)))
  await recordAudit(ctx, {
    entityType: 'equipment_category',
    entityId: id,
    action: 'delete',
    summary: 'Deleted equipment category',
  })
  revalidatePath(BASE)
}

export default async function EquipmentCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const drawerParam = pickString(sp.drawer)
  const params = parseListParams(sp, {
    sort: 'order',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const page = params.page
  const perPage = params.perPage
  const ctx = await requireModuleManage('equipment')

  const { categories, total, typeCounts, editingRow } = await ctx.db(async (tx) => {
    const search: SQL<unknown> | undefined = params.q
      ? or(
          ilike(equipmentCategories.name, `%${params.q}%`),
          ilike(equipmentCategories.slug, `%${params.q}%`),
          ilike(equipmentCategories.description, `%${params.q}%`),
        )
      : undefined

    const dirFn = params.dir === 'asc' ? asc : desc
    const orderBy =
      params.sort === 'name'
        ? [dirFn(equipmentCategories.name)]
        : params.sort === 'slug'
          ? [dirFn(equipmentCategories.slug)]
          : [dirFn(equipmentCategories.sortOrder), asc(equipmentCategories.name)]

    const [tot] = await tx.select({ c: count() }).from(equipmentCategories).where(search)
    const c = await tx
      .select()
      .from(equipmentCategories)
      .where(search)
      .orderBy(...orderBy)
      .limit(perPage)
      .offset((page - 1) * perPage)
    const tally = await tx
      .select({ categoryId: equipmentTypes.categoryId, c: count() })
      .from(equipmentTypes)
      .groupBy(equipmentTypes.categoryId)
    // Edit row fetched by id so the drawer opens regardless of which page it's on.
    const ed =
      drawerParam && drawerParam !== 'new'
        ? ((
            await tx
              .select()
              .from(equipmentCategories)
              .where(eq(equipmentCategories.id, drawerParam))
              .limit(1)
          )[0] ?? null)
        : null
    return {
      categories: c,
      total: Number(tot?.c ?? 0),
      typeCounts: Object.fromEntries(
        tally
          .filter((x) => x.categoryId !== null)
          .map((x) => [x.categoryId as string, Number(x.c)]),
      ),
      editingRow: ed,
    }
  })
  const editing: CategoryEditing | null = editingRow
    ? {
        id: editingRow.id,
        name: editingRow.name,
        description: editingRow.description,
        sortOrder: editingRow.sortOrder,
      }
    : null
  const mode: 'new' | 'edit' | null = drawerParam === 'new' ? 'new' : editing ? 'edit' : null
  const closeHref = mergeHref(BASE, sp, { drawer: undefined })
  const newHref = mergeHref(BASE, sp, { drawer: 'new' })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Equipment categories"
            description="Buckets that group equipment types — e.g. Tools, Vehicles, Lifts. Used in the rate matrix and reports."
            actions={
              <Link href={newHref as never} scroll={false}>
                <Button>
                  <Plus size={14} /> New category
                </Button>
              </Link>
            }
          />
          <EquipmentSubNav active="categories" />
          <TableToolbar>
            <SearchInput placeholder="Search name, slug, description…" />
          </TableToolbar>
        </>
      }
    >
      {categories.length === 0 ? (
        <EmptyState
          icon={<Tags size={32} />}
          title={params.q ? 'No categories match your search' : 'No categories'}
          description="Create a category to organise equipment types in the rate matrix."
          action={
            <Link href={newHref as never} scroll={false}>
              <Button>New category</Button>
            </Link>
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
                  column="name"
                  active={params.sort === 'name'}
                >
                  Name
                </SortableTh>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  dir={params.dir}
                  column="slug"
                  active={params.sort === 'slug'}
                >
                  Slug
                </SortableTh>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  dir={params.dir}
                  column="order"
                  active={params.sort === 'order'}
                  align="right"
                  className="text-right"
                >
                  Order
                </SortableTh>
                <TableHead className="text-right">Types</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categories.map((c) => {
                const used = typeCounts[c.id] ?? 0
                const editHref = mergeHref(BASE, sp, { drawer: c.id })
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link
                        href={editHref as never}
                        scroll={false}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {c.name}
                      </Link>
                      {c.description ? (
                        <div className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                          {c.description}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-500 dark:text-slate-400">
                      {c.slug}
                    </TableCell>
                    <TableCell className="text-right text-slate-600 tabular-nums dark:text-slate-400">
                      {c.sortOrder}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{used}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Link
                          href={editHref as never}
                          scroll={false}
                          className="rounded px-2 py-1 text-xs text-teal-700 hover:bg-teal-50 hover:underline dark:text-teal-400 dark:hover:bg-teal-500/10"
                        >
                          Edit
                        </Link>
                        <form action={deleteCategory} className="inline">
                          <input type="hidden" name="id" value={c.id} />
                          <button
                            type="submit"
                            disabled={used > 0}
                            title={
                              used > 0
                                ? `${used} type(s) reference this category — reassign before deleting`
                                : 'Delete category'
                            }
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                          >
                            <Trash2 size={14} />
                          </button>
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Pagination
        basePath={BASE}
        currentParams={sp}
        total={total}
        page={page}
        perPage={perPage}
      />

      <EquipmentCategoryDrawer
        mode={mode}
        editing={editing}
        closeHref={closeHref}
        saveAction={saveCategory}
      />
    </ListPageLayout>
  )
}
