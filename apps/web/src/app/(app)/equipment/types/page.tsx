import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { Boxes, Plus, Trash2 } from 'lucide-react'
import { asc, count, eq } from 'drizzle-orm'
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
import { equipmentCategories, equipmentItems, equipmentTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { clamp, mergeHref, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { EquipmentTypeDrawer, type TypeEditing } from './_drawers'

export const metadata = { title: 'Equipment types' }
export const dynamic = 'force-dynamic'

const BASE = '/equipment/types'

async function saveType(input: {
  id?: string
  name: string
  description: string | null
  categoryId: string | null
  everyDays: number | null
  oilMonths: number | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'equipment')
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required' }
  const inspectionSchedule = input.everyDays != null ? { everyDays: input.everyDays } : null
  const values = {
    name,
    description: input.description,
    categoryId: input.categoryId,
    defaultOilChangeIntervalMonths: input.oilMonths,
    inspectionSchedule,
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
  await ctx.db((tx) => tx.delete(equipmentTypes).where(eq(equipmentTypes.id, id)))
  await recordAudit(ctx, {
    entityType: 'equipment_type',
    entityId: id,
    action: 'delete',
    summary: 'Deleted equipment type',
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
  const page = clamp(Number(pickString(sp.page) ?? '1'), 1, 10_000)
  const perPage = 25
  const ctx = await requireModuleManage('equipment')

  const { types, total, categories, counts, editingRow } = await ctx.db(async (tx) => {
    const [tot] = await tx.select({ c: count() }).from(equipmentTypes)
    const t = await tx
      .select({ type: equipmentTypes, cat: equipmentCategories })
      .from(equipmentTypes)
      .leftJoin(equipmentCategories, eq(equipmentCategories.id, equipmentTypes.categoryId))
      .orderBy(asc(equipmentTypes.name))
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
      editingRow: ed,
    }
  })

  const editing: TypeEditing | null = editingRow
    ? {
        id: editingRow.id,
        name: editingRow.name,
        description: editingRow.description,
        categoryId: editingRow.categoryId,
        everyDays: editingRow.inspectionSchedule?.everyDays ?? null,
        oilMonths: editingRow.defaultOilChangeIntervalMonths ?? null,
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
            description="Equipment groupings with default schedules and templates."
            actions={
              <Link href={newHref as never} scroll={false}>
                <Button>
                  <Plus size={14} /> New type
                </Button>
              </Link>
            }
          />
          <EquipmentSubNav active="types" />
        </>
      }
    >
      {types.length === 0 ? (
        <EmptyState
          icon={<Boxes size={32} />}
          title="No equipment types"
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
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Inspection (days)</TableHead>
                <TableHead className="text-right">Oil change (mo.)</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map(({ type, cat }) => {
                const n = counts[type.id] ?? 0
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
                      {cat?.name ?? type.category ?? <span className="text-slate-400">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-slate-600 tabular-nums dark:text-slate-400">
                      {type.inspectionSchedule?.everyDays ?? '—'}
                    </TableCell>
                    <TableCell className="text-right text-slate-600 tabular-nums dark:text-slate-400">
                      {type.defaultOilChangeIntervalMonths ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{n}</Badge>
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
                            disabled={n > 0}
                            title={
                              n > 0
                                ? `${n} item(s) reference this type — reassign before deleting`
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

      {total > perPage ? (
        <Pagination
          basePath={BASE}
          currentParams={sp}
          total={total}
          page={page}
          perPage={perPage}
        />
      ) : null}

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
