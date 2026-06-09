import { revalidatePath } from 'next/cache'
import { asc, count, eq, sql } from 'drizzle-orm'
import { FolderTree, Trash2 } from 'lucide-react'
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
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@beaconhs/ui'
import { documentReferenceCategories, documentReferences } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { ListPageLayout } from '@/components/page-layout'
import { DocumentsSubNav } from '../../_components/documents-sub-nav'

export const metadata = { title: 'Reference categories' }
export const dynamic = 'force-dynamic'

async function createCategory(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'documents')
  const name = String(formData.get('name') ?? '').trim()
  const parentId = String(formData.get('parentId') ?? '').trim() || null
  const description = String(formData.get('description') ?? '').trim() || null
  if (!name) return
  const [row] = await ctx.db((tx) =>
    tx
      .insert(documentReferenceCategories)
      .values({ tenantId: ctx.tenantId, name, parentId, description })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'document_reference_category',
      entityId: row.id,
      action: 'create',
      summary: `Created reference category "${name}"`,
      after: { name, parentId, description },
    })
  }
  revalidatePath('/documents/reference/categories')
}

async function updateCategory(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'documents')
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const parentIdRaw = String(formData.get('parentId') ?? '').trim()
  const parentId = parentIdRaw && parentIdRaw !== id ? parentIdRaw : null
  const description = String(formData.get('description') ?? '').trim() || null
  if (!id || !name) return
  await ctx.db((tx) =>
    tx
      .update(documentReferenceCategories)
      .set({ name, parentId, description })
      .where(eq(documentReferenceCategories.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'document_reference_category',
    entityId: id,
    action: 'update',
    summary: 'Updated reference category',
    after: { name, parentId, description },
  })
  revalidatePath('/documents/reference/categories')
}

async function deleteCategory(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'documents')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db((tx) =>
    tx
      .update(documentReferenceCategories)
      .set({ deletedAt: new Date() })
      .where(eq(documentReferenceCategories.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'document_reference_category',
    entityId: id,
    action: 'delete',
    summary: 'Soft-deleted reference category',
  })
  revalidatePath('/documents/reference/categories')
}

function renderTree(
  nodes: { id: string; name: string; description: string | null; parentId: string | null }[],
  parentId: string | null,
  depth: number,
  usageMap: Record<string, number>,
  all: { id: string; name: string; description: string | null; parentId: string | null }[],
): React.ReactNode[] {
  const rows: React.ReactNode[] = []
  for (const node of nodes.filter((n) => n.parentId === parentId)) {
    const usage = usageMap[node.id] ?? 0
    rows.push(
      <TableRow key={node.id}>
        <TableCell>
          <form action={updateCategory} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input type="hidden" name="id" value={node.id} />
            <span
              className="inline-block shrink-0 text-slate-400"
              style={{ width: `${depth * 16}px` }}
              aria-hidden
            />
            <Input
              name="name"
              defaultValue={node.name}
              className="min-w-0 max-w-xs"
            />
            <Select
              name="parentId"
              defaultValue={node.parentId ?? ''}
              className="min-w-0 max-w-xs"
            >
              <option value="">— top level —</option>
              {all
                .filter((o) => o.id !== node.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
            </Select>
            <Input
              name="description"
              defaultValue={node.description ?? ''}
              placeholder="description"
              className="min-w-0 max-w-sm"
            />
            <Button type="submit" size="sm" variant="outline">
              Save
            </Button>
          </form>
        </TableCell>
        <TableCell>
          <Badge variant={usage > 0 ? 'secondary' : 'outline'}>
            {usage} {usage === 1 ? 'reference' : 'references'}
          </Badge>
        </TableCell>
        <TableCell>
          <form action={deleteCategory} className="inline">
            <input type="hidden" name="id" value={node.id} />
            <Button type="submit" variant="ghost" size="sm" aria-label="Delete category">
              <Trash2 size={14} className="text-red-500" />
            </Button>
          </form>
        </TableCell>
      </TableRow>,
    )
    rows.push(...renderTree(nodes, node.id, depth + 1, usageMap, all))
  }
  return rows
}

export default async function ReferenceCategoriesPage() {
  const ctx = await requireModuleManage('documents')
  const { rows, usageMap } = await ctx.db(async (tx) => {
    const data = await tx
      .select({
        id: documentReferenceCategories.id,
        name: documentReferenceCategories.name,
        description: documentReferenceCategories.description,
        parentId: documentReferenceCategories.parentId,
      })
      .from(documentReferenceCategories)
      .where(sql`${documentReferenceCategories.deletedAt} is null`)
      .orderBy(asc(documentReferenceCategories.name))
    const usage = await tx
      .select({ categoryId: documentReferences.category, c: count() })
      .from(documentReferences)
      .where(sql`${documentReferences.category} is not null`)
      .groupBy(documentReferences.category)
    return {
      rows: data,
      usageMap: Object.fromEntries(usage.map((u) => [u.categoryId ?? '', Number(u.c)])),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Reference categories"
            description="Hierarchical groupings for reference-library entries — nest sub-categories underneath each parent."
          />
          <DocumentsSubNav active="reference" />
        </>
      }
    >
      <div className="space-y-5">
        <nav className="flex gap-2 text-xs">
          <a
            href="/documents/reference"
            className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
          >
            ← Reference library
          </a>
          <a
            href="/documents/reference/types"
            className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
          >
            Types
          </a>
          <a
            href="/documents/reference/categories"
            className="rounded-md border border-teal-500 bg-teal-50 px-2 py-1 font-medium text-teal-700"
          >
            Categories
          </a>
        </nav>

        <Card>
          <CardHeader>
            <CardTitle>Create a new category</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createCategory} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" name="name" required placeholder="e.g. Hazardous chemicals" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="parentId">Parent (optional)</Label>
                <Select id="parentId" name="parentId" defaultValue="">
                  <option value="">— top level —</option>
                  {rows.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" name="description" rows={2} />
              </div>
              <div className="sm:col-span-2 flex justify-end">
                <Button type="submit">Add category</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {rows.length === 0 ? (
          <EmptyState
            icon={<FolderTree size={32} />}
            title="No reference categories yet"
            description="Add categories to organise the reference library."
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Category tree ({rows.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name / parent</TableHead>
                    <TableHead>Used by</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>{renderTree(rows, null, 0, usageMap, rows)}</TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </ListPageLayout>
  )
}
