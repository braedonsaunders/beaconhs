import { revalidatePath } from 'next/cache'
import { asc, count, eq, sql } from 'drizzle-orm'
import { Tag, Trash2 } from 'lucide-react'
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
import { documentReferenceTypes, documentReferences } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { ListPageLayout } from '@/components/page-layout'
import { DocumentsSubNav } from '../../_components/documents-sub-nav'

export const metadata = { title: 'Reference types' }
export const dynamic = 'force-dynamic'

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

async function createType(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'documents')
  const name = String(formData.get('name') ?? '').trim()
  const keyInput = String(formData.get('key') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  if (!name) return
  const key = keyInput ? slugify(keyInput) : slugify(name)
  if (!key) return

  const [row] = await ctx.db((tx) =>
    tx
      .insert(documentReferenceTypes)
      .values({ tenantId: ctx.tenantId, key, name, description })
      .onConflictDoNothing({
        target: [documentReferenceTypes.tenantId, documentReferenceTypes.key],
      })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'document_reference_type',
      entityId: row.id,
      action: 'create',
      summary: `Created reference type "${name}"`,
      after: { name, key },
    })
  }
  revalidatePath('/documents/reference/types')
}

async function updateType(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'documents')
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  if (!id || !name) return
  await ctx.db((tx) =>
    tx
      .update(documentReferenceTypes)
      .set({ name, description })
      .where(eq(documentReferenceTypes.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'document_reference_type',
    entityId: id,
    action: 'update',
    summary: 'Updated reference type',
    after: { name, description },
  })
  revalidatePath('/documents/reference/types')
}

async function deleteType(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'documents')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db((tx) =>
    tx
      .update(documentReferenceTypes)
      .set({ deletedAt: new Date() })
      .where(eq(documentReferenceTypes.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'document_reference_type',
    entityId: id,
    action: 'delete',
    summary: 'Soft-deleted reference type',
  })
  revalidatePath('/documents/reference/types')
}

export default async function ReferenceTypesPage() {
  const ctx = await requireModuleManage('documents')
  const { rows, usageMap } = await ctx.db(async (tx) => {
    const data = await tx
      .select()
      .from(documentReferenceTypes)
      .where(sql`${documentReferenceTypes.deletedAt} is null`)
      .orderBy(asc(documentReferenceTypes.name))
    const usage = await tx
      .select({ typeId: documentReferences.typeId, c: count() })
      .from(documentReferences)
      .where(sql`${documentReferences.typeId} is not null`)
      .groupBy(documentReferences.typeId)
    return {
      rows: data,
      usageMap: Object.fromEntries(usage.map((u) => [u.typeId ?? '', Number(u.c)])),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Reference types"
            description="Admin-managed classification for reference-library entries (SDS, manuals, standards, …)."
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
            className="rounded-md border border-teal-500 bg-teal-50 px-2 py-1 font-medium text-teal-700"
          >
            Types
          </a>
          <a
            href="/documents/reference/categories"
            className="rounded-md border border-slate-200 px-2 py-1 text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700"
          >
            Categories
          </a>
        </nav>

        <Card>
          <CardHeader>
            <CardTitle>Create a new reference type</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createType} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" name="name" required placeholder="e.g. SDS sheet" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="key">Key</Label>
                <Input id="key" name="key" placeholder="auto-generated" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" name="description" rows={2} />
              </div>
              <div className="sm:col-span-2 flex justify-end">
                <Button type="submit">Add type</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {rows.length === 0 ? (
          <EmptyState
            icon={<Tag size={32} />}
            title="No reference types yet"
            description="Add types like SDS, Manual, Standard so admins can classify reference entries consistently."
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Existing types ({rows.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Used by</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t) => {
                    const usage = usageMap[t.id] ?? 0
                    return (
                      <TableRow key={t.id}>
                        <TableCell>
                          <form
                            action={updateType}
                            className="flex flex-col gap-2 sm:flex-row sm:items-center"
                          >
                            <input type="hidden" name="id" value={t.id} />
                            <Input
                              name="name"
                              defaultValue={t.name}
                              className="min-w-0 max-w-xs"
                            />
                            <Input
                              name="description"
                              defaultValue={t.description ?? ''}
                              placeholder="description"
                              className="min-w-0 max-w-md"
                            />
                            <Button type="submit" size="sm" variant="outline">
                              Save
                            </Button>
                          </form>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{t.key}</TableCell>
                        <TableCell>
                          <Badge variant={usage > 0 ? 'secondary' : 'outline'}>
                            {usage} {usage === 1 ? 'reference' : 'references'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <form action={deleteType} className="inline">
                            <input type="hidden" name="id" value={t.id} />
                            <Button type="submit" variant="ghost" size="sm" aria-label="Delete">
                              <Trash2 size={14} className="text-red-500" />
                            </Button>
                          </form>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </ListPageLayout>
  )
}
