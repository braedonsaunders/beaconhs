import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { Boxes, Plus, Trash2 } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or, type SQL } from 'drizzle-orm'
import { assertComplianceTargetCanRetire } from '@beaconhs/compliance'
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
import {
  equipmentCategories,
  equipmentInspectionTypes,
  equipmentItems,
  equipmentTypes,
  customFieldDefinitions,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit, recordAuditInTransaction } from '@/lib/audit'
import { mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { countScopedCustomFields } from '@/lib/custom-fields/subtype-retirement'
import { EquipmentTypeDrawer, type TypeEditing } from './_drawers'

export const metadata = { title: 'Equipment types' }
export const dynamic = 'force-dynamic'

const BASE = '/equipment/types'
const SORTS = ['name', 'category'] as const

async function saveType(input: {
  id?: string
  name: string
  description: string | null
  categoryId: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'equipment')
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required' }
  const values = {
    name,
    description: input.description,
    categoryId: input.categoryId,
  }
  const id = await ctx.db(async (tx) => {
    if (input.id) {
      await tx.update(equipmentTypes).set(values).where(eq(equipmentTypes.id, input.id))
      return input.id
    }
    const [row] = await tx
      .insert(equipmentTypes)
      .values({ tenantId: ctx.tenantId, ...values })
      .returning({ id: equipmentTypes.id })
    return row?.id
  })
  if (!id) return { ok: false, error: 'Failed to save equipment type' }
  await recordAudit(ctx, {
    entityType: 'equipment_type',
    entityId: id,
    action: input.id ? 'update' : 'create',
    summary: `${input.id ? 'Updated' : 'Created'} equipment type "${name}"`,
  })
  revalidatePath(BASE)
  return { ok: true }
}

async function deleteType(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'equipment')
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return
  await ctx.db(async (tx) => {
    const [type] = await tx
      .select({ id: equipmentTypes.id })
      .from(equipmentTypes)
      .where(and(eq(equipmentTypes.tenantId, ctx.tenantId), eq(equipmentTypes.id, id)))
      .limit(1)
      .for('update')
    if (!type) throw new Error('Equipment type not found')
    await assertComplianceTargetCanRetire(tx, ctx.tenantId, 'equipment_type', id)

    // Server-side usage check — the disabled delete button is advisory only.
    // Items reference types with no ON DELETE action (a bare delete would 500
    // on the FK), and inspection templates can be pinned to a type.
    const [itemUse] = await tx
      .select({ c: count() })
      .from(equipmentItems)
      .where(and(eq(equipmentItems.tenantId, ctx.tenantId), eq(equipmentItems.typeId, id)))
    const [templateUse] = await tx
      .select({ c: count() })
      .from(equipmentInspectionTypes)
      .where(
        and(
          eq(equipmentInspectionTypes.tenantId, ctx.tenantId),
          eq(equipmentInspectionTypes.appliesToTypeId, id),
        ),
      )
    const items = Number(itemUse?.c ?? 0)
    const templates = Number(templateUse?.c ?? 0)
    const customFields = await countScopedCustomFields(tx, ctx.tenantId, 'equipment', id)
    if (items > 0 || templates > 0 || customFields > 0) {
      throw new Error(
        `Cannot delete: ${[
          items > 0 ? `${items} item${items === 1 ? '' : 's'}` : null,
          templates > 0 ? `${templates} inspection type${templates === 1 ? '' : 's'}` : null,
          customFields > 0
            ? `${customFields} scoped custom field${customFields === 1 ? '' : 's'}`
            : null,
        ]
          .filter(Boolean)
          .join(' and ')} reference this type. Reassign them first.`,
      )
    }
    await tx
      .delete(equipmentTypes)
      .where(and(eq(equipmentTypes.tenantId, ctx.tenantId), eq(equipmentTypes.id, id)))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment_type',
      entityId: id,
      action: 'delete',
      summary: 'Deleted equipment type',
    })
  })
  revalidatePath(BASE)
}

export default async function EquipmentTypesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const drawerParam = pickString(sp.drawer)
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const page = params.page
  const perPage = params.perPage
  const ctx = await requireModuleManage('equipment')

  const { types, total, categories, counts, templateCounts, fieldCounts, editingRow } =
    await ctx.db(async (tx) => {
      const search: SQL<unknown> | undefined = params.q
        ? or(
            ilike(equipmentTypes.name, `%${params.q}%`),
            ilike(equipmentTypes.description, `%${params.q}%`),
          )
        : undefined

      const dirFn = params.dir === 'asc' ? asc : desc
      const orderBy =
        params.sort === 'category'
          ? [dirFn(equipmentCategories.name), asc(equipmentTypes.name)]
          : [dirFn(equipmentTypes.name)]

      const [tot] = await tx.select({ c: count() }).from(equipmentTypes).where(search)
      const t = await tx
        .select({ type: equipmentTypes, cat: equipmentCategories })
        .from(equipmentTypes)
        .leftJoin(equipmentCategories, eq(equipmentCategories.id, equipmentTypes.categoryId))
        .where(search)
        .orderBy(...orderBy)
        .limit(perPage)
        .offset((page - 1) * perPage)
      const c = await tx
        .select()
        .from(equipmentCategories)
        .orderBy(asc(equipmentCategories.sortOrder), asc(equipmentCategories.name))
      const tally = await tx
        .select({ typeId: equipmentItems.typeId, c: count() })
        .from(equipmentItems)
        .groupBy(equipmentItems.typeId)
      const templateTally = await tx
        .select({ typeId: equipmentInspectionTypes.appliesToTypeId, c: count() })
        .from(equipmentInspectionTypes)
        .where(isNotNull(equipmentInspectionTypes.appliesToTypeId))
        .groupBy(equipmentInspectionTypes.appliesToTypeId)
      const fieldTally = await tx
        .select({ typeId: customFieldDefinitions.subtypeId, c: count() })
        .from(customFieldDefinitions)
        .where(
          and(
            eq(customFieldDefinitions.entityKind, 'equipment'),
            isNull(customFieldDefinitions.deletedAt),
            isNotNull(customFieldDefinitions.subtypeId),
          ),
        )
        .groupBy(customFieldDefinitions.subtypeId)
      // Edit row fetched by id so the drawer opens regardless of which page it's on.
      const ed =
        drawerParam && drawerParam !== 'new'
          ? ((
              await tx
                .select()
                .from(equipmentTypes)
                .where(eq(equipmentTypes.id, drawerParam))
                .limit(1)
            )[0] ?? null)
          : null
      return {
        types: t,
        total: Number(tot?.c ?? 0),
        categories: c,
        counts: Object.fromEntries(tally.map((x) => [x.typeId, Number(x.c)])),
        templateCounts: Object.fromEntries(templateTally.map((x) => [x.typeId, Number(x.c)])),
        fieldCounts: Object.fromEntries(fieldTally.map((x) => [x.typeId, Number(x.c)])),
        editingRow: ed,
      }
    })

  const editing: TypeEditing | null = editingRow
    ? {
        id: editingRow.id,
        name: editingRow.name,
        description: editingRow.description,
        categoryId: editingRow.categoryId,
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
            title="Equipment types"
            description="The make/model catalogue every asset is classified against."
            actions={
              <Link href={newHref as never} scroll={false}>
                <Button>
                  <Plus size={14} /> New type
                </Button>
              </Link>
            }
          />
          <EquipmentSubNav active="types" />
          <TableToolbar>
            <SearchInput placeholder="Search name, description…" />
          </TableToolbar>
        </>
      }
    >
      {types.length === 0 ? (
        <EmptyState
          icon={<Boxes size={32} />}
          title={params.q ? 'No equipment types match your search' : 'No equipment types'}
          description="Add a type to group the asset register and define inspection cadence."
          action={
            <Link href={newHref as never} scroll={false}>
              <Button>New type</Button>
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
                  column="category"
                  active={params.sort === 'category'}
                >
                  Category
                </SortableTh>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Custom fields</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map(({ type, cat }) => {
                const n = counts[type.id] ?? 0
                const templateCount = templateCounts[type.id] ?? 0
                const fieldCount = fieldCounts[type.id] ?? 0
                const blockers = [
                  n > 0 ? `${n} item(s)` : null,
                  templateCount > 0 ? `${templateCount} inspection type(s)` : null,
                  fieldCount > 0 ? `${fieldCount} scoped custom field(s)` : null,
                ].filter(Boolean)
                const editHref = mergeHref(BASE, sp, { drawer: type.id })
                return (
                  <TableRow key={type.id}>
                    <TableCell>
                      <Link
                        href={editHref as never}
                        scroll={false}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {type.name}
                      </Link>
                      {type.description ? (
                        <div className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                          {type.description}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">
                      {cat?.name ?? <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{n}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{fieldCount}</Badge>
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
                        <form action={deleteType} className="inline">
                          <input type="hidden" name="id" value={type.id} />
                          <button
                            type="submit"
                            disabled={blockers.length > 0}
                            title={
                              blockers.length > 0
                                ? `${blockers.join(', ')} reference this type — reassign or remove them before deleting`
                                : 'Delete type'
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

      <Pagination basePath={BASE} currentParams={sp} total={total} page={page} perPage={perPage} />

      <EquipmentTypeDrawer
        mode={mode}
        editing={editing}
        closeHref={closeHref}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        saveAction={saveType}
      />
    </ListPageLayout>
  )
}
