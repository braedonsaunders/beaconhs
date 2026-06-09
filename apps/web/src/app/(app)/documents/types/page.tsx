import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { asc, count, desc, eq, sql } from 'drizzle-orm'
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
import { documentTypes, documents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { ListPageLayout } from '@/components/page-layout'
import { DocumentsSubNav } from '../_components/documents-sub-nav'

export const metadata = { title: 'Document types' }
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
  const color = String(formData.get('color') ?? '').trim() || null
  if (!name) return
  const key = keyInput ? slugify(keyInput) : slugify(name)
  if (!key) return

  const [row] = await ctx.db(async (tx) => {
    return tx
      .insert(documentTypes)
      .values({ tenantId: ctx.tenantId, key, name, description, color })
      .onConflictDoNothing({ target: [documentTypes.tenantId, documentTypes.key] })
      .returning()
  })
  if (row) {
    await recordAudit(ctx, {
      entityType: 'document_type',
      entityId: row.id,
      action: 'create',
      summary: `Created document type "${name}"`,
      after: { name, key, color },
    })
  }
  revalidatePath('/documents/types')
}

async function updateType(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'documents')
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const color = String(formData.get('color') ?? '').trim() || null
  if (!id || !name) return
  await ctx.db((tx) =>
    tx
      .update(documentTypes)
      .set({ name, description, color })
      .where(eq(documentTypes.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'document_type',
    entityId: id,
    action: 'update',
    summary: 'Updated document type',
    after: { name, description, color },
  })
  revalidatePath('/documents/types')
}

async function deleteType(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'documents')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db((tx) =>
    tx.update(documentTypes).set({ deletedAt: new Date() }).where(eq(documentTypes.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'document_type',
    entityId: id,
    action: 'delete',
    summary: 'Soft-deleted document type',
  })
  revalidatePath('/documents/types')
}

export default async function DocumentTypesPage() {
  const ctx = await requireModuleManage('documents')

  const { rows, usageMap } = await ctx.db(async (tx) => {
    const data = await tx
      .select()
      .from(documentTypes)
      .where(sql`${documentTypes.deletedAt} is null`)
      .orderBy(asc(documentTypes.name))
    const usage = await tx
      .select({ typeId: documents.typeId, c: count() })
      .from(documents)
      .where(sql`${documents.typeId} is not null`)
      .groupBy(documents.typeId)
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
            title="Document types"
            description="Admin-managed classification for documents. Each type can have a name, key, colour and description."
          />
          <DocumentsSubNav active="types" />
        </>
      }
    >
      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Create a new type</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createType} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" name="name" required placeholder="e.g. Policy" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="key">Key</Label>
                <Input id="key" name="key" placeholder="auto-generated from name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="color">Colour</Label>
                <Input id="color" name="color" type="color" defaultValue="#0f766e" />
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
            title="No document types yet"
            description="Add types like Policy, Procedure, SDS, Manual so authors can classify documents consistently."
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
                    <TableHead>Colour</TableHead>
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
                            <Input
                              name="color"
                              type="color"
                              defaultValue={t.color ?? '#0f766e'}
                              className="h-8 w-12 shrink-0 p-0"
                            />
                            <Button type="submit" size="sm" variant="outline">
                              Save
                            </Button>
                          </form>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{t.key}</TableCell>
                        <TableCell>
                          <span
                            className="inline-block h-4 w-8 rounded border border-slate-200 align-middle"
                            style={{ background: t.color ?? '#0f766e' }}
                          />
                        </TableCell>
                        <TableCell className="text-slate-600">
                          <Badge variant={usage > 0 ? 'secondary' : 'outline'}>
                            {usage} {usage === 1 ? 'document' : 'documents'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <form action={deleteType} className="inline">
                            <input type="hidden" name="id" value={t.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              aria-label="Delete type"
                            >
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
