import { revalidatePath } from 'next/cache'
import { Tags, Trash2 } from 'lucide-react'
import { asc, count, eq } from 'drizzle-orm'
import {
  Badge,
  Button,
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
import { equipmentCategories, equipmentTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { ListPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'

export const metadata = { title: 'Equipment categories' }
export const dynamic = 'force-dynamic'

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function createCategory(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const sortOrder = Number(String(formData.get('sortOrder') ?? '0')) || 0
  if (!name) return
  const slug = slugify(name)

  const inserted = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(equipmentCategories)
      .values({ tenantId: ctx.tenantId, name, slug, description, sortOrder })
      .onConflictDoNothing({
        target: [equipmentCategories.tenantId, equipmentCategories.slug],
      })
      .returning({ id: equipmentCategories.id })
    return row
  })
  if (inserted?.id) {
    await recordAudit(ctx, {
      entityType: 'equipment_category',
      entityId: inserted.id,
      action: 'create',
      summary: `Created equipment category "${name}"`,
      after: { name, slug, description, sortOrder },
    })
  }
  revalidatePath('/equipment/categories')
}

async function updateCategory(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '').trim()
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const sortOrder = Number(String(formData.get('sortOrder') ?? '0')) || 0
  if (!id || !name) return
  await ctx.db((tx) =>
    tx.update(equipmentCategories).set({ name, description, sortOrder }).where(eq(equipmentCategories.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'equipment_category',
    entityId: id,
    action: 'update',
    summary: `Updated equipment category "${name}"`,
    after: { name, description, sortOrder },
  })
  revalidatePath('/equipment/categories')
}

async function deleteCategory(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return
  await ctx.db((tx) => tx.delete(equipmentCategories).where(eq(equipmentCategories.id, id)))
  await recordAudit(ctx, {
    entityType: 'equipment_category',
    entityId: id,
    action: 'delete',
    summary: 'Deleted equipment category',
  })
  revalidatePath('/equipment/categories')
}

export default async function EquipmentCategoriesPage() {
  const ctx = await requireRequestContext()
  const { categories, typeCounts } = await ctx.db(async (tx) => {
    const c = await tx
      .select()
      .from(equipmentCategories)
      .orderBy(asc(equipmentCategories.sortOrder), asc(equipmentCategories.name))
    const tally = await tx
      .select({ categoryId: equipmentTypes.categoryId, c: count() })
      .from(equipmentTypes)
      .groupBy(equipmentTypes.categoryId)
    return {
      categories: c,
      typeCounts: Object.fromEntries(
        tally
          .filter((x) => x.categoryId !== null)
          .map((x) => [x.categoryId as string, Number(x.c)]),
      ),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="categories" />
          <PageHeader
            title="Equipment categories"
            description="Buckets that group equipment types — e.g. Tools, Vehicles, Lifts, Trailers. Used in the rate matrix and reports."
          />
        </>
      }
    >
      <div className="space-y-6">
        <Section title={`Categories (${categories.length})`} defaultOpen>
          {categories.length === 0 ? (
            <EmptyState
              icon={<Tags size={28} />}
              title="No categories yet"
              description="Create your first category to organise equipment types in the rate matrix."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Slug</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Order</TableHead>
                    <TableHead className="text-right">Types</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((c) => {
                    const used = typeCounts[c.id] ?? 0
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <form action={updateCategory} className="flex items-center gap-2">
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="sortOrder" value={c.sortOrder} />
                            <Input
                              name="name"
                              defaultValue={c.name}
                              className="h-8 max-w-xs"
                            />
                            <input
                              type="hidden"
                              name="description"
                              defaultValue={c.description ?? ''}
                            />
                            <Button type="submit" size="sm" variant="outline">
                              Save
                            </Button>
                          </form>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-slate-500">
                          {c.slug}
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-sm text-slate-600">
                          {c.description ?? '—'}
                        </TableCell>
                        <TableCell className="text-right text-slate-600">{c.sortOrder}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary">{used}</Badge>
                        </TableCell>
                        <TableCell>
                          <form action={deleteCategory} className="flex justify-end">
                            <input type="hidden" name="id" value={c.id} />
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              disabled={used > 0}
                              title={
                                used > 0
                                  ? `Cannot delete — ${used} type(s) reference this category`
                                  : 'Delete category'
                              }
                            >
                              <Trash2 size={12} />
                            </Button>
                          </form>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>

        <Section title="Add a new category" defaultOpen>
          <form action={createCategory} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input name="name" required placeholder="e.g. Vehicles" />
            </div>
            <div className="space-y-1.5">
              <Label>Sort order</Label>
              <Input name="sortOrder" type="number" defaultValue="0" />
            </div>
            <div className="space-y-1.5 sm:col-span-3">
              <Label>Description</Label>
              <Textarea name="description" rows={2} />
            </div>
            <div className="sm:col-span-3 flex justify-end">
              <Button type="submit">Add category</Button>
            </div>
          </form>
        </Section>
      </div>
    </ListPageLayout>
  )
}
