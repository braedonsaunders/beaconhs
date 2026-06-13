// /incidents/classifications — tenant admin defines the hierarchical
// taxonomy used to bucket incidents.
//
// Tree is rendered as a nested list (depth-2 in practice).  Per-row inline
// form lets an admin create child nodes without leaving the page.  The
// `recordable` flag is what drives every TRIR/DART rollup downstream.
//
// All mutations recordAudit (entityType='incident_classification').

import { revalidatePath } from 'next/cache'
import { Plus, Trash2, Archive, ArchiveRestore } from 'lucide-react'
import { asc, eq } from 'drizzle-orm'
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
  Textarea,
} from '@beaconhs/ui'
import { incidentClassifications, incidents } from '@beaconhs/db/schema'
import { count, sql } from 'drizzle-orm'
import { requireRequestContext } from '@/lib/auth'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { ListPageLayout } from '@/components/page-layout'
import { IncidentsSubNav } from '../_sub-nav'

export const metadata = { title: 'Incident classifications' }
export const dynamic = 'force-dynamic'

type ClassificationRow = {
  id: string
  parentId: string | null
  name: string
  description: string | null
  code: string | null
  isRecordable: number
  isActive: number
  sortOrder: number | null
}

async function createClassification(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'incidents')
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  const parentId = String(formData.get('parentId') ?? '').trim() || null
  const description = String(formData.get('description') ?? '').trim() || null
  const code = String(formData.get('code') ?? '').trim() || null
  const isRecordable = formData.get('isRecordable') === 'on' ? 1 : 0

  // Belt-and-braces sort-order: append at the end of the parent's children.
  const sortOrder = await ctx.db(async (tx) => {
    const [tail] = await tx
      .select({ s: sql<number>`coalesce(max(${incidentClassifications.sortOrder}), 0)` })
      .from(incidentClassifications)
      .where(
        parentId
          ? eq(incidentClassifications.parentId, parentId)
          : sql`${incidentClassifications.parentId} is null`,
      )
    return Number(tail?.s ?? 0) + 10
  })

  const [row] = await ctx.db((tx) =>
    tx
      .insert(incidentClassifications)
      .values({
        tenantId: ctx.tenantId,
        parentId,
        name,
        description,
        code,
        isRecordable,
        sortOrder,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning(),
  )
  if (row) {
    await recordAudit(ctx, {
      entityType: 'incident_classification',
      entityId: row.id,
      action: 'create',
      summary: `Created classification "${name}"${parentId ? ' (child)' : ''}`,
      after: { name, parentId, code, isRecordable: !!isRecordable },
    })
  }
  revalidatePath('/incidents/classifications')
}

async function updateClassification(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'incidents')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const code = String(formData.get('code') ?? '').trim() || null
  const isRecordable = formData.get('isRecordable') === 'on' ? 1 : 0
  if (!name) return

  const before = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(incidentClassifications)
      .where(eq(incidentClassifications.id, id))
      .limit(1)
    return row ?? null
  })
  if (!before) return

  await ctx.db((tx) =>
    tx
      .update(incidentClassifications)
      .set({ name, description, code, isRecordable })
      .where(eq(incidentClassifications.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'incident_classification',
    entityId: id,
    action: 'update',
    summary: `Updated "${name}"`,
    before: {
      name: before.name,
      description: before.description,
      code: before.code,
      isRecordable: !!before.isRecordable,
    },
    after: { name, description, code, isRecordable: !!isRecordable },
  })
  revalidatePath('/incidents/classifications')
}

async function toggleArchive(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'incidents')
  const id = String(formData.get('id') ?? '')
  const next = formData.get('isActive') === 'true' ? 1 : 0
  if (!id) return
  await ctx.db((tx) =>
    tx
      .update(incidentClassifications)
      .set({ isActive: next })
      .where(eq(incidentClassifications.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'incident_classification',
    entityId: id,
    action: 'update',
    summary: next ? 'Restored from archive' : 'Archived',
    after: { isActive: !!next },
  })
  revalidatePath('/incidents/classifications')
}

async function deleteClassification(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'incidents')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  // Refuse if any incidents reference this classification — admin must
  // re-tag them first.  Cheaper than a soft delete + tombstone migration.
  const [{ usage } = { usage: 0 }] = await ctx.db((tx) =>
    tx.select({ usage: count() }).from(incidents).where(eq(incidents.classificationId, id)),
  )
  if (Number(usage ?? 0) > 0) {
    // Fall back to archive — safest outcome.  The UI flags the path.
    await ctx.db((tx) =>
      tx
        .update(incidentClassifications)
        .set({ isActive: 0 })
        .where(eq(incidentClassifications.id, id)),
    )
    await recordAudit(ctx, {
      entityType: 'incident_classification',
      entityId: id,
      action: 'archive',
      summary: 'Archived (referenced by existing incidents — hard delete refused)',
    })
  } else {
    await ctx.db((tx) =>
      tx.delete(incidentClassifications).where(eq(incidentClassifications.id, id)),
    )
    await recordAudit(ctx, {
      entityType: 'incident_classification',
      entityId: id,
      action: 'delete',
      summary: 'Deleted classification',
    })
  }
  revalidatePath('/incidents/classifications')
}

export default async function ClassificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const editingId =
    typeof sp.edit === 'string' ? sp.edit : Array.isArray(sp.edit) ? sp.edit[0] : undefined
  const createChildOf =
    typeof sp.childOf === 'string'
      ? sp.childOf
      : Array.isArray(sp.childOf)
        ? sp.childOf[0]
        : undefined
  const ctx = await requireModuleManage('incidents')

  const { rows, usageById } = await ctx.db(async (tx) => {
    const all = await tx
      .select({
        id: incidentClassifications.id,
        parentId: incidentClassifications.parentId,
        name: incidentClassifications.name,
        description: incidentClassifications.description,
        code: incidentClassifications.code,
        isRecordable: incidentClassifications.isRecordable,
        isActive: incidentClassifications.isActive,
        sortOrder: incidentClassifications.sortOrder,
      })
      .from(incidentClassifications)
      .orderBy(
        asc(incidentClassifications.parentId),
        asc(incidentClassifications.sortOrder),
        asc(incidentClassifications.name),
      )
    const usage = await tx
      .select({
        cId: incidents.classificationId,
        c: count(),
      })
      .from(incidents)
      .where(sql`${incidents.classificationId} is not null`)
      .groupBy(incidents.classificationId)
    const usageMap: Record<string, number> = {}
    for (const u of usage) if (u.cId) usageMap[u.cId] = Number(u.c)
    return { rows: all as ClassificationRow[], usageById: usageMap }
  })

  const roots = rows.filter((r) => r.parentId === null)
  const childrenOf = (id: string) => rows.filter((r) => r.parentId === id)
  const allOptions = [{ id: '', label: '— top level —' }].concat(
    roots.map((r) => ({ id: r.id, label: r.name })),
  )

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Incident classifications"
            description="Incident taxonomy; recordable nodes feed TRIR and DART."
          />
          <IncidentsSubNav active="classifications" />
        </>
      }
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-4">
          {roots.length === 0 ? (
            <EmptyState
              icon={<Plus size={32} />}
              title="No classifications"
              description="Add a top-level classification. Child categories can be nested underneath."
            />
          ) : (
            <ul className="space-y-3">
              {roots.map((root) => (
                <ClassificationNode
                  key={root.id}
                  node={root}
                  childNodes={childrenOf(root.id)}
                  usageById={usageById}
                  editingId={editingId}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Add classification</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={createClassification} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="parentId">Parent</Label>
                  <Select id="parentId" name="parentId" defaultValue={createChildOf ?? ''}>
                    {allOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name *</Label>
                  <Input id="name" name="name" required placeholder="e.g. Slip / trip / fall" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="code">Code</Label>
                    <Input id="code" name="code" placeholder="STF" maxLength={6} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="block">&nbsp;</Label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="isRecordable" defaultChecked />
                      Recordable
                    </label>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" name="description" rows={2} />
                </div>
                <div className="flex justify-end">
                  <Button type="submit">
                    <Plus size={14} /> Add
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How this is used</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-slate-600">
              <p>
                Every incident has a <strong>classification</strong>. Pick this when reporting or
                investigating. The TRIR / DART / OSHA-log reports roll up only nodes flagged
                <Badge variant="secondary" className="mr-1 ml-1">
                  recordable
                </Badge>
                — so leave non-recordable categories (near-miss, environmental, security) unflagged.
              </p>
              <p>
                Codes are surfaced on the OSHA-300 PDF and in CSV exports. Use 2-6 uppercase
                letters.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </ListPageLayout>
  )
}

function ClassificationNode({
  node,
  childNodes,
  usageById,
  editingId,
}: {
  node: ClassificationRow
  childNodes: ClassificationRow[]
  usageById: Record<string, number>
  editingId: string | undefined
}) {
  const isEditing = editingId === node.id
  const usage = usageById[node.id] ?? 0
  return (
    <li
      className={`rounded-lg border ${node.isActive ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50'} `}
    >
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <form action={updateClassification} className="space-y-2">
              <input type="hidden" name="id" value={node.id} />
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <Input name="name" defaultValue={node.name} required />
                <Input name="code" defaultValue={node.code ?? ''} placeholder="Code" />
              </div>
              <Textarea name="description" rows={2} defaultValue={node.description ?? ''} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isRecordable" defaultChecked={!!node.isRecordable} />
                Recordable
              </label>
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm">
                  Save
                </Button>
                <a
                  href="/incidents/classifications"
                  className="text-sm text-slate-500 hover:underline"
                >
                  Cancel
                </a>
              </div>
            </form>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-900">{node.name}</span>
                {node.code ? (
                  <Badge variant="outline" className="font-mono text-xs">
                    {node.code}
                  </Badge>
                ) : null}
                {node.isRecordable ? <Badge variant="secondary">Recordable</Badge> : null}
                {!node.isActive ? (
                  <Badge variant="outline" className="border-amber-300 text-amber-800">
                    Archived
                  </Badge>
                ) : null}
                {usage > 0 ? (
                  <span className="text-xs text-slate-500">
                    {usage} incident{usage === 1 ? '' : 's'}
                  </span>
                ) : null}
              </div>
              {node.description ? (
                <p className="mt-0.5 text-xs text-slate-500">{node.description}</p>
              ) : null}
            </>
          )}
        </div>
        {isEditing ? null : (
          <div className="flex items-center gap-1">
            <a
              href={`/incidents/classifications?edit=${node.id}`}
              className="text-xs text-teal-700 hover:underline"
            >
              Edit
            </a>
            <a
              href={`/incidents/classifications?childOf=${node.id}#add`}
              className="text-xs text-teal-700 hover:underline"
            >
              + Child
            </a>
            <form action={toggleArchive} className="inline">
              <input type="hidden" name="id" value={node.id} />
              <input type="hidden" name="isActive" value={node.isActive ? 'false' : 'true'} />
              <button
                type="submit"
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title={node.isActive ? 'Archive' : 'Restore'}
              >
                {node.isActive ? <Archive size={14} /> : <ArchiveRestore size={14} />}
              </button>
            </form>
            <form action={deleteClassification} className="inline">
              <input type="hidden" name="id" value={node.id} />
              <button
                type="submit"
                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                title={usage > 0 ? `${usage} incidents — will archive instead` : 'Delete'}
              >
                <Trash2 size={14} />
              </button>
            </form>
          </div>
        )}
      </div>
      {childNodes.length > 0 ? (
        <ul className="space-y-1.5 border-t border-slate-100 bg-slate-50/30 p-2 pl-8">
          {childNodes.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded border border-slate-100 bg-white px-3 py-1.5 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span>{c.name}</span>
                {c.code ? (
                  <Badge variant="outline" className="font-mono text-xs">
                    {c.code}
                  </Badge>
                ) : null}
                {c.isRecordable ? <Badge variant="secondary">Recordable</Badge> : null}
                {!c.isActive ? (
                  <Badge variant="outline" className="border-amber-300 text-amber-800">
                    Archived
                  </Badge>
                ) : null}
                {(usageById[c.id] ?? 0) > 0 ? (
                  <span className="text-xs text-slate-500">{usageById[c.id]} incidents</span>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <a
                  href={`/incidents/classifications?edit=${c.id}`}
                  className="text-xs text-teal-700 hover:underline"
                >
                  Edit
                </a>
                <form action={toggleArchive} className="inline">
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="isActive" value={c.isActive ? 'false' : 'true'} />
                  <button
                    type="submit"
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    {c.isActive ? <Archive size={12} /> : <ArchiveRestore size={12} />}
                  </button>
                </form>
                <form action={deleteClassification} className="inline">
                  <input type="hidden" name="id" value={c.id} />
                  <button
                    type="submit"
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 size={12} />
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}
