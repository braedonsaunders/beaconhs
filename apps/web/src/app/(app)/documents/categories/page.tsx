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
import { documentCategories, documents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { ListPageLayout } from '@/components/page-layout'
import { DocumentsSubNav } from '../_components/documents-sub-nav'

export const metadata = { title: 'Document categories' }
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
      .insert(documentCategories)
      .values({ tenantId: ctx.tenantId, name, parentId, description })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'document_category',
      entityId: row.id,
      action: 'create',
      summary: `Created document category "${name}"`,
      after: { name, parentId, description },
    })
  }
  revalidatePath('/documents/categories')
}

async function updateCategory(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'documents')
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const parentIdRaw = String(formData.get('parentId') ?? '').trim()
  let parentId = parentIdRaw && parentIdRaw !== id ? parentIdRaw : null
  const description = String(formData.get('description') ?? '').trim() || null
  if (!id || !name) return
  await ctx.db(async (tx) => {
    // Reject cycles (A→B→…→A): walk the proposed ancestor chain; if it ever
    // reaches this category, keep the current parent instead of vanishing the
    // whole branch from the tree.
    if (parentId) {
      const all = await tx
        .select({ id: documentCategories.id, parentId: documentCategories.parentId })
        .from(documentCategories)
      const parentOf = new Map(all.map((c) => [c.id, c.parentId]))
      const seen = new Set<string>()
      let cursor: string | null = parentId
      while (cursor) {
        if (cursor === id || seen.has(cursor)) {
          parentId = null
          break
        }
        seen.add(cursor)
        cursor = parentOf.get(cursor) ?? null
      }
    }
    await tx
      .update(documentCategories)
      .set({ name, parentId, description })
      .where(eq(documentCategories.id, id))
  })
  await recordAudit(ctx, {
    entityType: 'document_category',
    entityId: id,
    action: 'update',
    summary: 'Updated document category',
    after: { name, parentId, description },
  })
  revalidatePath('/documents/categories')
}

async function deleteCategory(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'documents')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ parentId: documentCategories.parentId })
      .from(documentCategories)
      .where(eq(documentCategories.id, id))
      .limit(1)
    if (!row) return
    // Re-parent children to the deleted node's parent so they stay visible and
    // manageable in the tree instead of becoming orphaned ghosts.
    await tx
      .update(documentCategories)
      .set({ parentId: row.parentId })
      .where(eq(documentCategories.parentId, id))
    await tx
      .update(documentCategories)
      .set({ deletedAt: new Date() })
      .where(eq(documentCategories.id, id))
  })
  await recordAudit(ctx, {
    entityType: 'document_category',
    entityId: id,
    action: 'delete',
    summary: 'Soft-deleted document category',
  })
  revalidatePath('/documents/categories')
}

// Render a tree row with indentation based on depth.
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
            <Input name="name" defaultValue={node.name} className="max-w-xs min-w-0" />
            <Select name="parentId" defaultValue={node.parentId ?? ''} className="max-w-xs min-w-0">
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
              className="max-w-sm min-w-0"
            />
            <Button type="submit" size="sm" variant="outline">
              Save
            </Button>
          </form>
        </TableCell>
        <TableCell>
          <Badge variant={usage > 0 ? 'secondary' : 'outline'}>
            {usage} {usage === 1 ? 'document' : 'documents'}
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

export default async function DocumentCategoriesPage() {
  const ctx = await requireModuleManage('documents')

  const { rows, usageMap } = await ctx.db(async (tx) => {
    const data = await tx
      .select({
        id: documentCategories.id,
        name: documentCategories.name,
        description: documentCategories.description,
        parentId: documentCategories.parentId,
      })
      .from(documentCategories)
      .where(sql`${documentCategories.deletedAt} is null`)
      .orderBy(asc(documentCategories.name))
    const usage = await tx
      .select({ categoryId: documents.categoryId, c: count() })
      .from(documents)
      .where(sql`${documents.categoryId} is not null`)
      .groupBy(documents.categoryId)
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
            title="Document categories"
            description="Hierarchical groupings for documents — pick a parent to nest sub-categories underneath it."
          />
          <DocumentsSubNav active="categories" />
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
              <div className="space-y-1.5">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" name="name" required placeholder="e.g. Safety / SDS / Acids" />
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
              <div className="flex justify-end sm:col-span-2">
                <Button type="submit">Add category</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {rows.length === 0 ? (
          <EmptyState
            icon={<FolderTree size={32} />}
            title="No categories"
            description="Add categories like Safety, HR, Operations and nest sub-categories underneath each."
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
