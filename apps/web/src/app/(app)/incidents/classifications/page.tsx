// /incidents/classifications — tenant admin defines the hierarchical taxonomy
// used to bucket incidents. Depth-2 in practice; the `recordable` flag drives
// every TRIR/DART rollup downstream.
//
// Standard table primitive for the list (parents with indented children);
// create + edit happen in a right-side flyout (?drawer=new[&parent=<id>] |
// ?drawer=<id>). Archive / delete stay as row actions. All mutations
// recordAudit (entityType='incident_classification').

import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { Plus, Trash2, Archive, ArchiveRestore } from 'lucide-react'
import { asc, eq, count, sql } from 'drizzle-orm'
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
import { incidentClassifications, incidents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { requireModuleManage, assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { mergeHref, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { IncidentsSubNav } from '../_sub-nav'
import { ClassificationDrawer, type ClassificationEditing } from './_drawers'

export const metadata = { title: 'Incident classifications' }
export const dynamic = 'force-dynamic'

const BASE = '/incidents/classifications'

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

async function saveClassification(input: {
  id?: string
  parentId: string | null
  name: string
  code: string | null
  description: string | null
  isRecordable: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'incidents')
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'Name is required.' }
  const isRecordable = input.isRecordable ? 1 : 0

  if (input.id) {
    const before = await ctx.db(async (tx) => {
      const [row] = await tx
        .select()
        .from(incidentClassifications)
        .where(eq(incidentClassifications.id, input.id!))
        .limit(1)
      return row ?? null
    })
    if (!before) return { ok: false, error: 'Classification not found.' }
    await ctx.db((tx) =>
      tx
        .update(incidentClassifications)
        .set({ name, description: input.description, code: input.code, isRecordable })
        .where(eq(incidentClassifications.id, input.id!)),
    )
    await recordAudit(ctx, {
      entityType: 'incident_classification',
      entityId: input.id,
      action: 'update',
      summary: `Updated "${name}"`,
      before: {
        name: before.name,
        description: before.description,
        code: before.code,
        isRecordable: !!before.isRecordable,
      },
      after: {
        name,
        description: input.description,
        code: input.code,
        isRecordable: !!isRecordable,
      },
    })
    revalidatePath(BASE)
    return { ok: true }
  }

  const parentId = input.parentId || null
  // Append at the end of the parent's children.
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
        description: input.description,
        code: input.code,
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
      after: { name, parentId, code: input.code, isRecordable: !!isRecordable },
    })
  }
  revalidatePath(BASE)
  return { ok: true }
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
  revalidatePath(BASE)
}

async function deleteClassification(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'incidents')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  // Refuse a hard delete if any incidents reference this classification — fall
  // back to archive. Cheaper than a soft delete + tombstone migration.
  const [{ usage } = { usage: 0 }] = await ctx.db((tx) =>
    tx.select({ usage: count() }).from(incidents).where(eq(incidents.classificationId, id)),
  )
  if (Number(usage ?? 0) > 0) {
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
  revalidatePath(BASE)
}

export default async function ClassificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const drawerParam = pickString(sp.drawer)
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
      .select({ cId: incidents.classificationId, c: count() })
      .from(incidents)
      .where(sql`${incidents.classificationId} is not null`)
      .groupBy(incidents.classificationId)
    const usageMap: Record<string, number> = {}
    for (const u of usage) if (u.cId) usageMap[u.cId] = Number(u.c)
    return { rows: all as ClassificationRow[], usageById: usageMap }
  })

  const roots = rows.filter((r) => r.parentId === null)
  const childrenOf = (id: string) => rows.filter((r) => r.parentId === id)

  const parentOptions = [{ id: '', label: '— top level —' }].concat(
    roots.map((r) => ({ id: r.id, label: r.name })),
  )
  const editingRow =
    drawerParam && drawerParam !== 'new' ? rows.find((r) => r.id === drawerParam) : undefined
  const editing: ClassificationEditing | null = editingRow
    ? {
        id: editingRow.id,
        name: editingRow.name,
        code: editingRow.code,
        description: editingRow.description,
        isRecordable: !!editingRow.isRecordable,
      }
    : null
  const mode: 'new' | 'edit' | null = drawerParam === 'new' ? 'new' : editing ? 'edit' : null
  const defaultParentId = mode === 'new' ? (pickString(sp.parent) ?? '') : ''
  const closeHref = mergeHref(BASE, sp, { drawer: undefined, parent: undefined })
  const newHref = mergeHref(BASE, sp, { drawer: 'new', parent: undefined })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Incident classifications"
            description="Incident taxonomy; recordable nodes feed TRIR and DART. Codes appear on the OSHA-300 log and CSV exports."
            actions={
              <Link href={newHref as any} scroll={false}>
                <Button>
                  <Plus size={14} /> New classification
                </Button>
              </Link>
            }
          />
          <IncidentsSubNav active="classifications" />
        </>
      }
    >
      {roots.length === 0 ? (
        <EmptyState
          icon={<Plus size={32} />}
          title="No classifications"
          description="Add a top-level classification. Child categories can be nested underneath."
          action={
            <Link href={newHref as any} scroll={false}>
              <Button>New classification</Button>
            </Link>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Recordable</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roots.map((root) => (
              <ClassificationRows
                key={root.id}
                node={root}
                childNodes={childrenOf(root.id)}
                usageById={usageById}
                sp={sp}
                toggleArchive={toggleArchive}
                deleteClassification={deleteClassification}
              />
            ))}
          </TableBody>
        </Table>
      )}

      <ClassificationDrawer
        mode={mode}
        editing={editing}
        parentOptions={parentOptions}
        defaultParentId={defaultParentId}
        closeHref={closeHref}
        saveAction={saveClassification}
      />
    </ListPageLayout>
  )
}

function ClassificationRows({
  node,
  childNodes,
  usageById,
  sp,
  toggleArchive,
  deleteClassification,
}: {
  node: ClassificationRow
  childNodes: ClassificationRow[]
  usageById: Record<string, number>
  sp: Record<string, string | string[] | undefined>
  toggleArchive: (formData: FormData) => Promise<void>
  deleteClassification: (formData: FormData) => Promise<void>
}) {
  return (
    <>
      <ClassificationRow
        node={node}
        depth={0}
        usage={usageById[node.id] ?? 0}
        sp={sp}
        toggleArchive={toggleArchive}
        deleteClassification={deleteClassification}
      />
      {childNodes.map((c) => (
        <ClassificationRow
          key={c.id}
          node={c}
          depth={1}
          usage={usageById[c.id] ?? 0}
          sp={sp}
          toggleArchive={toggleArchive}
          deleteClassification={deleteClassification}
        />
      ))}
    </>
  )
}

function ClassificationRow({
  node,
  depth,
  usage,
  sp,
  toggleArchive,
  deleteClassification,
}: {
  node: ClassificationRow
  depth: number
  usage: number
  sp: Record<string, string | string[] | undefined>
  toggleArchive: (formData: FormData) => Promise<void>
  deleteClassification: (formData: FormData) => Promise<void>
}) {
  const editHref = mergeHref(BASE, sp, { drawer: node.id, parent: undefined })
  const childHref = mergeHref(BASE, sp, { drawer: 'new', parent: node.id })
  return (
    <TableRow className={node.isActive ? undefined : 'opacity-70'}>
      <TableCell>
        <div className={depth > 0 ? 'flex items-center gap-2 pl-6' : 'flex items-center gap-2'}>
          {depth > 0 ? <span className="text-slate-300 dark:text-slate-600">└</span> : null}
          <Link
            href={editHref as any}
            scroll={false}
            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
          >
            {node.name}
          </Link>
        </div>
        {node.description ? (
          <div
            className={`mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400 ${depth > 0 ? 'pl-12' : ''}`}
          >
            {node.description}
          </div>
        ) : null}
      </TableCell>
      <TableCell>
        {node.code ? (
          <Badge variant="outline" className="font-mono text-xs">
            {node.code}
          </Badge>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </TableCell>
      <TableCell>
        {node.isRecordable ? (
          <Badge variant="secondary">Recordable</Badge>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </TableCell>
      <TableCell>
        {node.isActive ? (
          <Badge variant="success">Active</Badge>
        ) : (
          <Badge variant="outline" className="border-amber-300 text-amber-800">
            Archived
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right text-slate-600 tabular-nums dark:text-slate-400">
        {usage}
      </TableCell>
      <TableCell className="text-right">
        <div className="inline-flex items-center gap-1">
          <Link
            href={editHref as any}
            scroll={false}
            className="rounded px-2 py-1 text-xs text-teal-700 hover:bg-teal-50 hover:underline dark:text-teal-400 dark:hover:bg-teal-500/10"
          >
            Edit
          </Link>
          {depth === 0 ? (
            <Link
              href={childHref as any}
              scroll={false}
              className="rounded px-2 py-1 text-xs text-teal-700 hover:bg-teal-50 hover:underline dark:text-teal-400 dark:hover:bg-teal-500/10"
            >
              + Child
            </Link>
          ) : null}
          <form action={toggleArchive} className="inline">
            <input type="hidden" name="id" value={node.id} />
            <input type="hidden" name="isActive" value={node.isActive ? 'false' : 'true'} />
            <button
              type="submit"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              title={node.isActive ? 'Archive' : 'Restore'}
            >
              {node.isActive ? <Archive size={14} /> : <ArchiveRestore size={14} />}
            </button>
          </form>
          <form action={deleteClassification} className="inline">
            <input type="hidden" name="id" value={node.id} />
            <button
              type="submit"
              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              title={usage > 0 ? `${usage} incidents — will archive instead` : 'Delete'}
            >
              <Trash2 size={14} />
            </button>
          </form>
        </div>
      </TableCell>
    </TableRow>
  )
}
