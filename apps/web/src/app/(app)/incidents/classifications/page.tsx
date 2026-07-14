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
import { and, asc, count, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
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
import { isUuid, mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { IncidentsSubNav } from '../_sub-nav'
import { ClassificationDrawer, type ClassificationEditing } from './_drawers'

export const metadata = { title: 'Incident classifications' }
export const dynamic = 'force-dynamic'

const BASE = '/incidents/classifications'
const SORTS = ['taxonomy'] as const

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

function classificationWriteError(error: unknown): string {
  const code = (error as { code?: unknown })?.code
  if (code === '23505') return 'A classification with that name already exists at this level.'
  if (code === '23503') return 'The selected parent classification no longer exists.'
  return 'Could not save the classification. Please try again.'
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
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return { ok: false, error: 'Name is required.' }
  if (name.length > 200) return { ok: false, error: 'Name must be 200 characters or fewer.' }
  const code = typeof input.code === 'string' ? input.code.trim() || null : null
  if (code && code.length > 6) return { ok: false, error: 'Code must be 6 characters or fewer.' }
  const description =
    typeof input.description === 'string' ? input.description.trim() || null : null
  if (description && description.length > 10_000) {
    return { ok: false, error: 'Description must be 10,000 characters or fewer.' }
  }
  const isRecordable = input.isRecordable === true ? 1 : 0

  if (input.id) {
    if (!isUuid(input.id)) return { ok: false, error: 'Classification not found.' }
    const classificationId = input.id
    let before: typeof incidentClassifications.$inferSelect | null
    try {
      before = await ctx.db(async (tx) => {
        const [existing] = await tx
          .select()
          .from(incidentClassifications)
          .where(eq(incidentClassifications.id, classificationId))
          .limit(1)
          .for('update')
        if (!existing) return null
        const [updated] = await tx
          .update(incidentClassifications)
          .set({ name, description, code, isRecordable })
          .where(eq(incidentClassifications.id, classificationId))
          .returning({ id: incidentClassifications.id })
        return updated ? existing : null
      })
    } catch (error) {
      return { ok: false, error: classificationWriteError(error) }
    }
    if (!before) return { ok: false, error: 'Classification not found.' }
    await recordAudit(ctx, {
      entityType: 'incident_classification',
      entityId: classificationId,
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
        description,
        code,
        isRecordable: !!isRecordable,
      },
    })
    revalidatePath(BASE)
    return { ok: true }
  }

  const parentId = typeof input.parentId === 'string' && input.parentId ? input.parentId : null
  if (parentId && !isUuid(parentId)) {
    return { ok: false, error: 'Choose a valid parent classification.' }
  }
  let created: {
    row: typeof incidentClassifications.$inferSelect | null
    invalidParent: boolean
  }
  try {
    created = await ctx.db(async (tx) => {
      if (parentId) {
        const [parent] = await tx
          .select({ id: incidentClassifications.id })
          .from(incidentClassifications)
          .where(
            and(
              eq(incidentClassifications.id, parentId),
              isNull(incidentClassifications.parentId),
              isNull(incidentClassifications.deletedAt),
              eq(incidentClassifications.isActive, 1),
            ),
          )
          .limit(1)
        if (!parent) return { row: null, invalidParent: true }
      }

      // Append at the end of the parent's children in the same transaction as
      // the insert, so the validated parent cannot disappear between queries.
      const [tail] = await tx
        .select({ s: sql<number>`coalesce(max(${incidentClassifications.sortOrder}), 0)` })
        .from(incidentClassifications)
        .where(
          parentId
            ? eq(incidentClassifications.parentId, parentId)
            : sql`${incidentClassifications.parentId} is null`,
        )
      const sortOrder = Number(tail?.s ?? 0) + 10
      const [row] = await tx
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
        .returning()
      return { row: row ?? null, invalidParent: false }
    })
  } catch (error) {
    return { ok: false, error: classificationWriteError(error) }
  }
  if (created.invalidParent) {
    return { ok: false, error: 'Parent must be an active top-level classification.' }
  }
  const row = created.row
  if (!row) return { ok: false, error: 'Could not create the classification.' }
  if (row) {
    await recordAudit(ctx, {
      entityType: 'incident_classification',
      entityId: row.id,
      action: 'create',
      summary: `Created classification "${name}"${parentId ? ' (child)' : ''}`,
      after: { name, parentId, code, isRecordable: !!isRecordable },
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
  // The subtree stands or falls together: deleting a parent must never orphan
  // its children (parentId has no FK, and orphans vanish from this admin table
  // while staying selectable on incidents). Refuse a hard delete if any
  // incident references the node OR one of its children — fall back to
  // archiving the whole subtree. Cheaper than a soft delete + tombstone
  // migration.
  const { targetIds, usage } = await ctx.db(async (tx) => {
    const children = await tx
      .select({ id: incidentClassifications.id })
      .from(incidentClassifications)
      .where(eq(incidentClassifications.parentId, id))
    const targetIds = [id, ...children.map((c) => c.id)]
    const [row] = await tx
      .select({ usage: count() })
      .from(incidents)
      .where(inArray(incidents.classificationId, targetIds))
    return { targetIds, usage: Number(row?.usage ?? 0) }
  })
  const childCount = targetIds.length - 1
  if (usage > 0) {
    await ctx.db((tx) =>
      tx
        .update(incidentClassifications)
        .set({ isActive: 0 })
        .where(inArray(incidentClassifications.id, targetIds)),
    )
    await recordAudit(ctx, {
      entityType: 'incident_classification',
      entityId: id,
      action: 'archive',
      summary: 'Archived (referenced by existing incidents — hard delete refused)',
      metadata: { archivedIds: targetIds, childCount },
    })
  } else {
    await ctx.db((tx) =>
      tx.delete(incidentClassifications).where(inArray(incidentClassifications.id, targetIds)),
    )
    await recordAudit(ctx, {
      entityType: 'incident_classification',
      entityId: id,
      action: 'delete',
      summary:
        childCount > 0
          ? `Deleted classification and ${childCount} child categor${childCount === 1 ? 'y' : 'ies'}`
          : 'Deleted classification',
      metadata: { deletedIds: targetIds, childCount },
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
  const params = parseListParams(sp, {
    sort: 'taxonomy',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const drawerParam = pickString(sp.drawer)
  const statusParam = pickString(sp.status)
  const statusFilter =
    statusParam === 'active' || statusParam === 'archived' ? statusParam : undefined
  const ctx = await requireModuleManage('incidents')

  const { rows, total, usageById, childCountById } = await ctx.db(async (tx) => {
    const parent = alias(incidentClassifications, 'incident_classification_parent')
    const search: SQL<unknown> | undefined = params.q
      ? or(
          ilike(incidentClassifications.name, `%${params.q}%`),
          ilike(incidentClassifications.code, `%${params.q}%`),
          ilike(incidentClassifications.description, `%${params.q}%`),
          ilike(parent.name, `%${params.q}%`),
        )
      : undefined
    const status =
      statusFilter === 'active'
        ? eq(incidentClassifications.isActive, 1)
        : statusFilter === 'archived'
          ? eq(incidentClassifications.isActive, 0)
          : undefined
    const where = and(search, status)
    const [totalRow] = await tx
      .select({ c: count() })
      .from(incidentClassifications)
      .leftJoin(parent, eq(parent.id, incidentClassifications.parentId))
      .where(where)
    const data = await tx
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
      .leftJoin(parent, eq(parent.id, incidentClassifications.parentId))
      .where(where)
      .orderBy(
        asc(sql`coalesce(${incidentClassifications.parentId}, ${incidentClassifications.id})`),
        asc(sql`case when ${incidentClassifications.parentId} is null then 0 else 1 end`),
        asc(incidentClassifications.sortOrder),
        asc(incidentClassifications.name),
      )
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const rowIds = data.map((row) => row.id)
    const rootIds = data.filter((row) => row.parentId === null).map((row) => row.id)
    const [usage, childCounts] = await Promise.all([
      rowIds.length === 0
        ? []
        : tx
            .select({ cId: incidents.classificationId, c: count() })
            .from(incidents)
            .where(inArray(incidents.classificationId, rowIds))
            .groupBy(incidents.classificationId),
      rootIds.length === 0
        ? []
        : tx
            .select({ parentId: incidentClassifications.parentId, c: count() })
            .from(incidentClassifications)
            .where(inArray(incidentClassifications.parentId, rootIds))
            .groupBy(incidentClassifications.parentId),
    ])
    const usageMap: Record<string, number> = {}
    for (const u of usage) if (u.cId) usageMap[u.cId] = Number(u.c)
    return {
      rows: data as ClassificationRow[],
      total: Number(totalRow?.c ?? 0),
      usageById: usageMap,
      childCountById: Object.fromEntries(
        childCounts.flatMap((row) => (row.parentId ? [[row.parentId, Number(row.c)]] : [])),
      ) as Record<string, number>,
    }
  })
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
          <TableToolbar>
            <SearchInput placeholder="Search name, code, or parent…" />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={[
                { value: 'active', label: 'Active' },
                { value: 'archived', label: 'Archived' },
              ]}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Plus size={32} />}
          title={
            params.q || statusFilter
              ? 'No classifications match your filters'
              : 'No classifications'
          }
          description={
            params.q || statusFilter
              ? 'Clear the search or status filter to see other classifications.'
              : 'Add a top-level classification. Child categories can be nested underneath.'
          }
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
            {rows.map((node) => (
              <ClassificationRow
                key={node.id}
                node={node}
                depth={node.parentId ? 1 : 0}
                usage={usageById[node.id] ?? 0}
                childCount={childCountById[node.id] ?? 0}
                sp={sp}
                toggleArchive={toggleArchive}
                deleteClassification={deleteClassification}
              />
            ))}
          </TableBody>
        </Table>
      )}

      <Pagination
        basePath={BASE}
        currentParams={sp}
        total={total}
        page={params.page}
        perPage={params.perPage}
      />

      <ClassificationDrawer
        mode={mode}
        editing={editing}
        defaultParentId={defaultParentId}
        closeHref={closeHref}
        saveAction={saveClassification}
      />
    </ListPageLayout>
  )
}

function ClassificationRow({
  node,
  depth,
  usage,
  childCount,
  sp,
  toggleArchive,
  deleteClassification,
}: {
  node: ClassificationRow
  depth: number
  usage: number
  childCount: number
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
          {depth === 0 && node.isActive ? (
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
              title={
                usage > 0
                  ? `${usage} incidents — will archive instead`
                  : childCount > 0
                    ? `Delete (includes ${childCount} child categor${childCount === 1 ? 'y' : 'ies'})`
                    : 'Delete'
              }
            >
              <Trash2 size={14} />
            </button>
          </form>
        </div>
      </TableCell>
    </TableRow>
  )
}
