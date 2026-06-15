import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { Boxes, Pencil, Trash2 } from 'lucide-react'
import { asc, count, eq, sql } from 'drizzle-orm'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@beaconhs/ui'
import { equipmentCategories, equipmentItems, equipmentTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { ListPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'

export const metadata = { title: 'Equipment types' }
export const dynamic = 'force-dynamic'

async function createType(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'equipment')
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const categoryId = String(formData.get('categoryId') ?? '').trim() || null
  const interval = String(formData.get('intervalDays') ?? '').trim()
  const oilMonths = String(formData.get('oilMonths') ?? '').trim()
  const templateKey = String(formData.get('templateKey') ?? '').trim() || null
  if (!name) return

  const inserted = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(equipmentTypes)
      .values({
        tenantId: ctx.tenantId,
        name,
        description,
        categoryId,
        defaultOilChangeIntervalMonths: oilMonths ? Number(oilMonths) : null,
        inspectionSchedule:
          interval || templateKey
            ? {
                everyDays: interval ? Number(interval) : undefined,
                templateKey: templateKey ?? undefined,
              }
            : null,
        requiresPreUseInspection: templateKey ? { templateKey } : null,
      })
      .returning({ id: equipmentTypes.id })
    return row
  })
  if (inserted?.id) {
    await recordAudit(ctx, {
      entityType: 'equipment_type',
      entityId: inserted.id,
      action: 'create',
      summary: `Created equipment type "${name}"`,
      after: { name, description, categoryId, intervalDays: interval, oilMonths, templateKey },
    })
  }
  revalidatePath('/equipment/types')
}

async function updateType(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'equipment')
  const id = String(formData.get('id') ?? '').trim()
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const categoryId = String(formData.get('categoryId') ?? '').trim() || null
  const interval = String(formData.get('intervalDays') ?? '').trim()
  const oilMonths = String(formData.get('oilMonths') ?? '').trim()
  const templateKey = String(formData.get('templateKey') ?? '').trim() || null
  if (!id || !name) return

  await ctx.db((tx) =>
    tx
      .update(equipmentTypes)
      .set({
        name,
        description,
        categoryId,
        defaultOilChangeIntervalMonths: oilMonths ? Number(oilMonths) : null,
        inspectionSchedule:
          interval || templateKey
            ? {
                everyDays: interval ? Number(interval) : undefined,
                templateKey: templateKey ?? undefined,
              }
            : null,
        requiresPreUseInspection: templateKey ? { templateKey } : null,
      })
      .where(eq(equipmentTypes.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'equipment_type',
    entityId: id,
    action: 'update',
    summary: `Updated equipment type "${name}"`,
    after: { name, description, categoryId, intervalDays: interval, oilMonths, templateKey },
  })
  revalidatePath('/equipment/types')
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
  revalidatePath('/equipment/types')
}

export default async function EquipmentTypesPage() {
  const ctx = await requireModuleManage('equipment')
  const { types, categories, counts } = await ctx.db(async (tx) => {
    const t = await tx
      .select({
        type: equipmentTypes,
        cat: equipmentCategories,
      })
      .from(equipmentTypes)
      .leftJoin(equipmentCategories, eq(equipmentCategories.id, equipmentTypes.categoryId))
      .orderBy(asc(equipmentTypes.name))
    const c = await tx
      .select()
      .from(equipmentCategories)
      .orderBy(asc(equipmentCategories.sortOrder), asc(equipmentCategories.name))
    const tally = await tx
      .select({ typeId: equipmentItems.typeId, c: count() })
      .from(equipmentItems)
      .groupBy(equipmentItems.typeId)
    return {
      types: t,
      categories: c,
      counts: Object.fromEntries(tally.map((x) => [x.typeId, Number(x.c)])),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="types" />
          <PageHeader
            title="Equipment types"
            description="Equipment groupings with default schedules and templates."
          />
        </>
      }
    >
      <div className="space-y-6">
        <Section title={`Equipment types (${types.length})`} defaultOpen>
          {types.length === 0 ? (
            <EmptyState
              icon={<Boxes size={28} />}
              title="No equipment types"
              description="Add a type to group the asset register and define inspection cadence."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Pre-use template</TableHead>
                    <TableHead>Inspection every (days)</TableHead>
                    <TableHead>Oil change every (mo.)</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {types.map(({ type, cat }) => {
                    const sched = type.inspectionSchedule ?? null
                    const preUse = type.requiresPreUseInspection ?? null
                    const n = counts[type.id] ?? 0
                    return (
                      <TableRow key={type.id}>
                        <TableCell>
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {type.name}
                          </div>
                          {type.description ? (
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                              {type.description}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {cat?.name ?? type.category ?? '—'}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {preUse?.templateKey ? (
                            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">
                              {preUse.templateKey}
                            </code>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {sched?.everyDays ?? '—'}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {type.defaultOilChangeIntervalMonths ?? '—'}
                        </TableCell>
                        <TableCell className="text-right text-slate-600 dark:text-slate-400">
                          <Badge variant="secondary">{n}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <details className="relative">
                              <summary className="cursor-pointer list-none text-xs text-teal-700 hover:underline dark:text-teal-400">
                                Edit
                              </summary>
                              <div className="absolute right-0 z-10 mt-1 w-[28rem] rounded-md border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-800 dark:bg-slate-900">
                                <form action={updateType} className="space-y-3">
                                  <input type="hidden" name="id" value={type.id} />
                                  <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1.5">
                                      <Label>Name</Label>
                                      <Input name="name" defaultValue={type.name} required />
                                    </div>
                                    <div className="space-y-1.5">
                                      <Label>Category</Label>
                                      <Select
                                        name="categoryId"
                                        defaultValue={type.categoryId ?? ''}
                                      >
                                        <option value="">— None —</option>
                                        {categories.map((c) => (
                                          <option key={c.id} value={c.id}>
                                            {c.name}
                                          </option>
                                        ))}
                                      </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                      <Label>Inspection every (days)</Label>
                                      <Input
                                        name="intervalDays"
                                        type="number"
                                        min={1}
                                        defaultValue={sched?.everyDays ?? ''}
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <Label>Oil change every (months)</Label>
                                      <Input
                                        name="oilMonths"
                                        type="number"
                                        min={1}
                                        defaultValue={type.defaultOilChangeIntervalMonths ?? ''}
                                      />
                                    </div>
                                    <div className="col-span-2 space-y-1.5">
                                      <Label>Pre-use template key</Label>
                                      <Input
                                        name="templateKey"
                                        defaultValue={preUse?.templateKey ?? ''}
                                      />
                                    </div>
                                    <div className="col-span-2 space-y-1.5">
                                      <Label>Description</Label>
                                      <Textarea
                                        name="description"
                                        rows={2}
                                        defaultValue={type.description ?? ''}
                                      />
                                    </div>
                                  </div>
                                  <div className="flex justify-end gap-2">
                                    <Button size="sm" type="submit">
                                      <Pencil size={12} /> Save
                                    </Button>
                                  </div>
                                </form>
                              </div>
                            </details>
                            <form action={deleteType}>
                              <input type="hidden" name="id" value={type.id} />
                              <Button
                                type="submit"
                                size="sm"
                                variant="outline"
                                disabled={n > 0}
                                title={
                                  n > 0
                                    ? `Cannot delete — ${n} item(s) reference this type`
                                    : 'Delete type'
                                }
                              >
                                <Trash2 size={12} />
                              </Button>
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
        </Section>

        <Section title="Add a new equipment type" defaultOpen>
          <form action={createType} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Name *</Label>
              <Input name="name" required placeholder="e.g. Pickup truck" />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select name="categoryId" defaultValue="">
                <option value="">— None —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Pre-use template key</Label>
              <Input name="templateKey" placeholder="e.g. vehicle_pre_use" />
            </div>
            <div className="space-y-1.5">
              <Label>Inspection every (days)</Label>
              <Input name="intervalDays" type="number" min={1} placeholder="e.g. 365" />
            </div>
            <div className="space-y-1.5">
              <Label>Oil change every (months)</Label>
              <Input name="oilMonths" type="number" min={1} placeholder="e.g. 6" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Description</Label>
              <Textarea name="description" rows={2} />
            </div>
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit">Add type</Button>
            </div>
          </form>
        </Section>
      </div>
    </ListPageLayout>
  )
}
