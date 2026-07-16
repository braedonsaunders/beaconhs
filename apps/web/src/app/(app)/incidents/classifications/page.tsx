import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'
import { getTranslations } from 'next-intl/server'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'
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
import { getRegulatoryTerminology } from '@beaconhs/tenant'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_01ac1d8290d0a4') }
}
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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const regulatoryT = await getTranslations('Regulatory')
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
  const regulatory = getRegulatoryTerminology(ctx)

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
            title={tGenerated('m_01ac1d8290d0a4')}
            description={regulatoryT('classificationDescription', {
              abbreviation: regulatory.legislationAbbreviation,
            })}
            actions={
              <Link href={newHref as any} scroll={false}>
                <Button>
                  <Plus size={14} /> <GeneratedText id="m_1bab4688751c07" />
                </Button>
              </Link>
            }
          />
          <IncidentsSubNav active="classifications" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_1e8a3f7b06afc4')} />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'archived', label: 'Archived' },
              ]}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<Plus size={32} />}
              title={tGeneratedValue(
                params.q || statusFilter
                  ? tGenerated('m_01918377e907c2')
                  : tGenerated('m_0367f1278e6bbb'),
              )}
              description={tGeneratedValue(
                params.q || statusFilter
                  ? tGenerated('m_0ec63db9674d6a')
                  : tGenerated('m_0feb80fa77cb4a'),
              )}
              action={
                <Link href={newHref as any} scroll={false}>
                  <Button>
                    <GeneratedText id="m_1bab4688751c07" />
                  </Button>
                </Link>
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <GeneratedText id="m_02b18d5c7f6f2d" />
                  </TableHead>
                  <TableHead>
                    <GeneratedText id="m_0570e24c85cf95" />
                  </TableHead>
                  <TableHead>
                    <GeneratedText id="m_0ddb1a14aec473" />
                  </TableHead>
                  <TableHead>
                    <GeneratedText id="m_0b9da892d6faf0" />
                  </TableHead>
                  <TableHead className="text-right">
                    <GeneratedText id="m_1667b6eab4ed93" />
                  </TableHead>
                  <TableHead className="text-right">
                    <GeneratedText id="m_0a7f1858f2ec46" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <GeneratedValue
                  value={rows.map((node) => (
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
                />
              </TableBody>
            </Table>
          )
        }
      />

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const editHref = mergeHref(BASE, sp, { drawer: node.id, parent: undefined })
  const childHref = mergeHref(BASE, sp, { drawer: 'new', parent: node.id })
  return (
    <TableRow className={node.isActive ? undefined : 'opacity-70'}>
      <TableCell>
        <div className={depth > 0 ? 'flex items-center gap-2 pl-6' : 'flex items-center gap-2'}>
          <GeneratedValue
            value={depth > 0 ? <span className="text-slate-300 dark:text-slate-600">└</span> : null}
          />
          <Link
            href={editHref as any}
            scroll={false}
            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
          >
            <GeneratedValue value={node.name} />
          </Link>
        </div>
        <GeneratedValue
          value={
            node.description ? (
              <div
                className={`mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400 ${depth > 0 ? 'pl-12' : ''}`}
              >
                <GeneratedValue value={node.description} />
              </div>
            ) : null
          }
        />
      </TableCell>
      <TableCell>
        <GeneratedValue
          value={
            node.code ? (
              <Badge variant="outline" className="font-mono text-xs">
                <GeneratedValue value={node.code} />
              </Badge>
            ) : (
              <span className="text-xs text-slate-400">—</span>
            )
          }
        />
      </TableCell>
      <TableCell>
        <GeneratedValue
          value={
            node.isRecordable ? (
              <Badge variant="secondary">
                <GeneratedText id="m_0ddb1a14aec473" />
              </Badge>
            ) : (
              <span className="text-xs text-slate-400">—</span>
            )
          }
        />
      </TableCell>
      <TableCell>
        <GeneratedValue
          value={
            node.isActive ? (
              <Badge variant="success">
                <GeneratedText id="m_1e1b1fdb7dd78e" />
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-300 text-amber-800">
                <GeneratedText id="m_12a687134482ba" />
              </Badge>
            )
          }
        />
      </TableCell>
      <TableCell className="text-right text-slate-600 tabular-nums dark:text-slate-400">
        <GeneratedValue value={usage} />
      </TableCell>
      <TableCell className="text-right">
        <div className="inline-flex items-center gap-1">
          <Link
            href={editHref as any}
            scroll={false}
            className="rounded px-2 py-1 text-xs text-teal-700 hover:bg-teal-50 hover:underline dark:text-teal-400 dark:hover:bg-teal-500/10"
          >
            <GeneratedText id="m_03a66f9d34ac7b" />
          </Link>
          <GeneratedValue
            value={
              depth === 0 && node.isActive ? (
                <Link
                  href={childHref as any}
                  scroll={false}
                  className="rounded px-2 py-1 text-xs text-teal-700 hover:bg-teal-50 hover:underline dark:text-teal-400 dark:hover:bg-teal-500/10"
                >
                  <GeneratedText id="m_1268fd1cbf5ef6" />
                </Link>
              ) : null
            }
          />
          <form action={toggleArchive} className="inline">
            <input type="hidden" name="id" value={node.id} />
            <input type="hidden" name="isActive" value={node.isActive ? 'false' : 'true'} />
            <button
              type="submit"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              title={tGeneratedValue(
                node.isActive ? tGenerated('m_019c0a64030688') : tGenerated('m_19500e41842c99'),
              )}
            >
              <GeneratedValue
                value={node.isActive ? <Archive size={14} /> : <ArchiveRestore size={14} />}
              />
            </button>
          </form>
          <form action={deleteClassification} className="inline">
            <input type="hidden" name="id" value={node.id} />
            <button
              type="submit"
              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              title={tGeneratedValue(
                usage > 0
                  ? tGenerated('m_0b37ebf0b36498', { value0: usage })
                  : childCount > 0
                    ? tGenerated('m_13e67a1d2f2946', {
                        value0: childCount,
                        value1: childCount === 1 ? 'y' : 'ies',
                      })
                    : tGenerated('m_11773f3c3f7558'),
              )}
            >
              <Trash2 size={14} />
            </button>
          </form>
        </div>
      </TableCell>
    </TableRow>
  )
}
