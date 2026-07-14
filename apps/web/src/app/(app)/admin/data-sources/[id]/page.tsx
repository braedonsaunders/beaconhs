// /admin/data-sources/[id] — manage one data source: its column shape + (for
// reference kind) its rows. For responses kind, columns are snapshotted from
// the bound app and rows are live, so only a "resync columns" action is shown.

import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { and, asc, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
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
  Select,
  Textarea,
} from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import {
  dataSourceRows,
  dataSources,
  formTemplateVersions,
  formTemplates,
  type DataSourceColumn,
  type DataSourceColumnType,
} from '@beaconhs/db/schema'
import type { FormSchemaV1 } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { isUuid, mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { deriveColumnsFromSchema, slugify } from '../_shared'
import { collectDataSourceUsage } from '../_usage'

export const metadata = { title: 'Data source' }
export const dynamic = 'force-dynamic'

const ROW_SORTS = ['position', 'created'] as const
const USAGE_SORTS = ['app', 'fields'] as const

async function guard() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) return null
  return ctx
}

async function updateSource(formData: FormData): Promise<void> {
  'use server'
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  if (!id || !name) return
  await ctx.db((tx) =>
    tx.update(dataSources).set({ name, description }).where(eq(dataSources.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'data_source',
    entityId: id,
    action: 'update',
    summary: `Renamed to "${name}"`,
  })
  revalidatePath(`/admin/data-sources/${id}`)
}

async function addColumn(formData: FormData): Promise<void> {
  'use server'
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  const label = String(formData.get('label') ?? '').trim()
  if (!id || !label) return
  const type = (
    ['text', 'number', 'date', 'boolean'].includes(String(formData.get('type')))
      ? String(formData.get('type'))
      : 'text'
  ) as DataSourceColumnType
  const key = slugify(String(formData.get('key') ?? '').trim() || label).replace(/-/g, '_')

  const added = await ctx.db(async (tx) => {
    const [src] = await tx
      .select({ columns: dataSources.columns })
      .from(dataSources)
      .where(eq(dataSources.id, id))
      .limit(1)
    if (!src) return false
    const cols = (src.columns as DataSourceColumn[]) ?? []
    if (cols.some((c) => c.key === key)) return false
    await tx
      .update(dataSources)
      .set({ columns: [...cols, { key, label, type }] })
      .where(eq(dataSources.id, id))
    return true
  })
  if (added) {
    await recordAudit(ctx, {
      entityType: 'data_source',
      entityId: id,
      action: 'update',
      summary: `Added column "${label}"`,
      after: { key, label, type },
    })
  }
  revalidatePath(`/admin/data-sources/${id}`)
}

async function deleteColumn(formData: FormData): Promise<void> {
  'use server'
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  const key = String(formData.get('key') ?? '')
  if (!id || !key) return
  const removed = await ctx.db(async (tx) => {
    const [src] = await tx
      .select({ columns: dataSources.columns })
      .from(dataSources)
      .where(eq(dataSources.id, id))
      .limit(1)
    if (!src) return false
    const before = (src.columns as DataSourceColumn[]) ?? []
    const cols = before.filter((c) => c.key !== key)
    if (cols.length === before.length) return false
    await tx.update(dataSources).set({ columns: cols }).where(eq(dataSources.id, id))
    return true
  })
  if (removed) {
    await recordAudit(ctx, {
      entityType: 'data_source',
      entityId: id,
      action: 'update',
      summary: `Removed column "${key}"`,
      before: { key },
    })
  }
  revalidatePath(`/admin/data-sources/${id}`)
}

async function resyncColumns(formData: FormData): Promise<void> {
  'use server'
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const resynced = await ctx.db(async (tx) => {
    const [src] = await tx
      .select({ config: dataSources.config })
      .from(dataSources)
      .where(eq(dataSources.id, id))
      .limit(1)
    const templateId = src?.config?.templateId
    if (!templateId) return false
    const [ver] = await tx
      .select({ schema: formTemplateVersions.schema })
      .from(formTemplateVersions)
      .where(eq(formTemplateVersions.templateId, templateId))
      .orderBy(desc(formTemplateVersions.version))
      .limit(1)
    if (!ver?.schema) return false
    await tx
      .update(dataSources)
      .set({
        columns: deriveColumnsFromSchema(
          ver.schema as FormSchemaV1,
          ctx.defaultLocale,
          ctx.defaultLocale,
        ),
      })
      .where(eq(dataSources.id, id))
    return true
  })
  if (resynced) {
    await recordAudit(ctx, {
      entityType: 'data_source',
      entityId: id,
      action: 'update',
      summary: 'Resynced columns from the bound app',
    })
  }
  revalidatePath(`/admin/data-sources/${id}`)
}

// Read all `col__<key>` form entries into a row data object, coercing by the
// source's declared column types.
function readRowData(formData: FormData, cols: DataSourceColumn[]): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const c of cols) {
    const raw = formData.get(`col__${c.key}`)
    if (c.type === 'boolean') {
      data[c.key] = raw === 'on'
    } else if (c.type === 'number') {
      const n = Number(String(raw ?? '').trim())
      data[c.key] = Number.isFinite(n) && String(raw ?? '').trim() !== '' ? n : null
    } else {
      const s = String(raw ?? '').trim()
      data[c.key] = s === '' ? null : s
    }
  }
  return data
}

async function addRow(formData: FormData): Promise<void> {
  'use server'
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const inserted = await ctx.db(async (tx) => {
    const [src] = await tx
      .select({ columns: dataSources.columns })
      .from(dataSources)
      .where(eq(dataSources.id, id))
      .limit(1)
    if (!src) return null
    const cols = (src.columns as DataSourceColumn[]) ?? []
    const data = readRowData(formData, cols)
    const [{ p } = { p: 0 }] = await tx
      .select({ p: sql<number>`coalesce(max(${dataSourceRows.position}), 0)` })
      .from(dataSourceRows)
      .where(eq(dataSourceRows.dataSourceId, id))
    const [row] = await tx
      .insert(dataSourceRows)
      .values({ tenantId: ctx.tenantId, dataSourceId: id, data, position: Number(p ?? 0) + 10 })
      .returning({ id: dataSourceRows.id })
    return row?.id ?? null
  })
  if (inserted) {
    await recordAudit(ctx, {
      entityType: 'data_source',
      entityId: id,
      action: 'update',
      summary: 'Added a row',
      metadata: { rowId: inserted },
    })
  }
  revalidatePath(`/admin/data-sources/${id}`)
}

async function updateRow(formData: FormData): Promise<void> {
  'use server'
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  if (!id || !rowId) return
  const updated = await ctx.db(async (tx) => {
    const [src] = await tx
      .select({ columns: dataSources.columns })
      .from(dataSources)
      .where(eq(dataSources.id, id))
      .limit(1)
    if (!src) return false
    const cols = (src.columns as DataSourceColumn[]) ?? []
    const data = readRowData(formData, cols)
    // Pin the row to the posted source so a crafted form can't rewrite a row
    // that belongs to a different data source.
    const rows = await tx
      .update(dataSourceRows)
      .set({ data })
      .where(and(eq(dataSourceRows.id, rowId), eq(dataSourceRows.dataSourceId, id)))
      .returning({ id: dataSourceRows.id })
    return rows.length > 0
  })
  if (updated) {
    await recordAudit(ctx, {
      entityType: 'data_source',
      entityId: id,
      action: 'update',
      summary: 'Updated a row',
      metadata: { rowId },
    })
  }
  revalidatePath(`/admin/data-sources/${id}`)
}

async function deleteRow(formData: FormData): Promise<void> {
  'use server'
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  if (!id || !rowId) return
  const deleted = await ctx.db(async (tx) => {
    const rows = await tx
      .update(dataSourceRows)
      .set({ deletedAt: new Date() })
      .where(and(eq(dataSourceRows.id, rowId), eq(dataSourceRows.dataSourceId, id)))
      .returning({ id: dataSourceRows.id })
    return rows.length > 0
  })
  if (deleted) {
    await recordAudit(ctx, {
      entityType: 'data_source',
      entityId: id,
      action: 'update',
      summary: 'Deleted a row',
      metadata: { rowId },
    })
  }
  revalidatePath(`/admin/data-sources/${id}`)
}

function inputTypeFor(t: DataSourceColumnType): string {
  if (t === 'number') return 'number'
  if (t === 'date') return 'date'
  return 'text'
}

export default async function DataSourceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const sp = await searchParams
  const editingRow = pickString(sp.editRow)
  const rowParams = parseListParams(
    { q: sp.rowQ, sort: sp.rowSort, dir: sp.rowDir, page: sp.rowPage, perPage: sp.rowPerPage },
    { sort: 'position', dir: 'asc', perPage: 25, allowedSorts: ROW_SORTS },
  )
  const usageParams = parseListParams(
    {
      q: sp.usageQ,
      sort: sp.usageSort,
      dir: sp.usageDir,
      page: sp.usagePage,
      perPage: sp.usagePerPage,
    },
    { sort: 'app', dir: 'asc', perPage: 10, allowedSorts: USAGE_SORTS },
  )
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')

  const data = await ctx.db(async (tx) => {
    const [src] = await tx.select().from(dataSources).where(eq(dataSources.id, id)).limit(1)
    if (!src || src.deletedAt) return null
    const rowSearch: SQL<unknown> | undefined = rowParams.q
      ? sql`${dataSourceRows.data}::text ilike ${`%${rowParams.q}%`}`
      : undefined
    const rowWhere = and(
      eq(dataSourceRows.dataSourceId, id),
      isNull(dataSourceRows.deletedAt),
      rowSearch,
    )
    const rowDirFn = rowParams.dir === 'asc' ? asc : desc
    const rowOrderBy =
      rowParams.sort === 'created'
        ? [rowDirFn(dataSourceRows.createdAt)]
        : [rowDirFn(dataSourceRows.position), asc(dataSourceRows.createdAt)]
    const [rows, rowTotalRow] =
      src.kind === 'reference'
        ? await Promise.all([
            tx
              .select({ id: dataSourceRows.id, data: dataSourceRows.data })
              .from(dataSourceRows)
              .where(rowWhere)
              .orderBy(...rowOrderBy)
              .limit(rowParams.perPage)
              .offset((rowParams.page - 1) * rowParams.perPage),
            tx.select({ c: count() }).from(dataSourceRows).where(rowWhere),
          ])
        : [[], []]
    let templateName: string | null = null
    if (src.kind === 'responses' && src.config?.templateId) {
      const [t] = await tx
        .select({ name: formTemplates.name })
        .from(formTemplates)
        .where(eq(formTemplates.id, src.config.templateId))
        .limit(1)
      templateName = t?.name ?? null
    }
    const versionRows = await tx
      .select({
        templateId: formTemplates.id,
        templateName: formTemplates.name,
        version: formTemplateVersions.version,
        schema: formTemplateVersions.schema,
      })
      .from(formTemplateVersions)
      .innerJoin(formTemplates, eq(formTemplates.id, formTemplateVersions.templateId))
      .where(isNull(formTemplates.deletedAt))
      .orderBy(asc(formTemplates.name), desc(formTemplateVersions.version))
    const allUsage =
      collectDataSourceUsage(versionRows, ctx.locale, ctx.defaultLocale).get(src.key) ?? []
    const matchingUsage = allUsage.filter((entry) => {
      if (!usageParams.q) return true
      const query = usageParams.q.toLowerCase()
      return [entry.templateName, ...entry.fields.map((field) => field.fieldLabel)]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
    const usageDir = usageParams.dir === 'asc' ? 1 : -1
    matchingUsage.sort((a, b) => {
      if (usageParams.sort === 'fields') {
        return (
          (a.fields.length - b.fields.length || a.templateName.localeCompare(b.templateName)) *
          usageDir
        )
      }
      return a.templateName.localeCompare(b.templateName) * usageDir
    })
    const usage = matchingUsage.slice(
      (usageParams.page - 1) * usageParams.perPage,
      usageParams.page * usageParams.perPage,
    )
    return {
      src,
      rows,
      rowTotal: Number(rowTotalRow[0]?.c ?? 0),
      templateName,
      usage,
      usageTotal: matchingUsage.length,
      usageAllTotal: allUsage.length,
    }
  })

  if (!data) notFound()
  const { src, rows, rowTotal, templateName, usage, usageTotal, usageAllTotal } = data
  const cols = (src.columns as DataSourceColumn[]) ?? []
  const isReference = src.kind === 'reference'

  return (
    <PageContainer>
      <div className="space-y-6">
        <div>
          <Link
            href="/admin/data-sources"
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400"
          >
            <ArrowLeft size={14} /> Data sources
          </Link>
        </div>

        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {src.name}
              </h1>
              <Badge variant={isReference ? 'outline' : 'secondary'}>
                {isReference ? 'Reference' : 'Live responses'}
              </Badge>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Key{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs dark:bg-slate-800">
                {src.key}
              </code>
              {!isReference && templateName ? (
                <>
                  {' '}
                  · live from <strong>{templateName}</strong>
                </>
              ) : null}
            </p>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          {/* LEFT: rows (reference) or live note (responses) */}
          <div className="space-y-4">
            {isReference ? (
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Rows</CardTitle>
                  <span className="text-xs text-slate-400">{rowTotal} total</span>
                </CardHeader>
                <CardContent>
                  {cols.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Add columns first (right) — then you can add rows.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {/* Add-row form */}
                      <form
                        action={addRow}
                        className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-2.5 dark:border-slate-800 dark:bg-slate-800/40"
                      >
                        <input type="hidden" name="id" value={src.id} />
                        {cols.map((c) => (
                          <div key={c.key} className="space-y-1">
                            <Label className="text-[11px] text-slate-500 dark:text-slate-400">
                              {c.label}
                            </Label>
                            {c.type === 'boolean' ? (
                              <input type="checkbox" name={`col__${c.key}`} className="block h-9" />
                            ) : (
                              <Input
                                name={`col__${c.key}`}
                                type={inputTypeFor(c.type)}
                                className="h-9 w-36"
                                placeholder={c.label}
                              />
                            )}
                          </div>
                        ))}
                        <Button type="submit" size="sm">
                          <Plus size={14} /> Add row
                        </Button>
                      </form>

                      <TableToolbar>
                        <SearchInput
                          placeholder="Search row values…"
                          paramKey="rowQ"
                          pageParamKey="rowPage"
                        />
                        <FilterChips
                          basePath={`/admin/data-sources/${src.id}`}
                          currentParams={sp}
                          paramKey="rowSort"
                          pageParamKey="rowPage"
                          label="Sort"
                          defaultValue="position"
                          hideAll
                          options={[
                            { value: 'position', label: 'Manual order' },
                            { value: 'created', label: 'Created date' },
                          ]}
                        />
                      </TableToolbar>

                      {rows.length === 0 ? (
                        <EmptyState
                          icon={<Plus size={28} />}
                          title={rowParams.q ? 'No matching rows' : 'No rows'}
                          description={
                            rowParams.q
                              ? 'Adjust the row search.'
                              : 'Use the form above to add a row.'
                          }
                        />
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-slate-200 text-left text-xs tracking-wide text-slate-400 uppercase dark:border-slate-800">
                                {cols.map((c) => (
                                  <th key={c.key} className="px-2 py-1.5 font-medium">
                                    {c.label}
                                  </th>
                                ))}
                                <th className="px-2 py-1.5" />
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r) => {
                                const rd = (r.data as Record<string, unknown>) ?? {}
                                const isEditing = editingRow === r.id
                                if (isEditing) {
                                  return (
                                    <tr
                                      key={r.id}
                                      className="border-b border-slate-100 bg-teal-50/30 dark:border-slate-800 dark:bg-teal-500/10"
                                    >
                                      <td colSpan={cols.length + 1} className="px-2 py-2">
                                        <form
                                          action={updateRow}
                                          className="flex flex-wrap items-end gap-2"
                                        >
                                          <input type="hidden" name="id" value={src.id} />
                                          <input type="hidden" name="rowId" value={r.id} />
                                          {cols.map((c) => (
                                            <div key={c.key} className="space-y-1">
                                              <Label className="text-[11px] text-slate-500 dark:text-slate-400">
                                                {c.label}
                                              </Label>
                                              {c.type === 'boolean' ? (
                                                <input
                                                  type="checkbox"
                                                  name={`col__${c.key}`}
                                                  defaultChecked={!!rd[c.key]}
                                                  className="block h-9"
                                                />
                                              ) : (
                                                <Input
                                                  name={`col__${c.key}`}
                                                  type={inputTypeFor(c.type)}
                                                  className="h-9 w-36"
                                                  defaultValue={
                                                    rd[c.key] == null ? '' : String(rd[c.key])
                                                  }
                                                />
                                              )}
                                            </div>
                                          ))}
                                          <Button type="submit" size="sm">
                                            Save
                                          </Button>
                                          <Link
                                            href={mergeHref(`/admin/data-sources/${src.id}`, sp, {
                                              editRow: undefined,
                                            })}
                                            className="px-1 text-sm text-slate-500 hover:underline dark:text-slate-400"
                                          >
                                            Cancel
                                          </Link>
                                        </form>
                                      </td>
                                    </tr>
                                  )
                                }
                                return (
                                  <tr
                                    key={r.id}
                                    className="border-b border-slate-100 hover:bg-slate-50/60 dark:border-slate-800 dark:hover:bg-slate-800/40"
                                  >
                                    {cols.map((c) => (
                                      <td
                                        key={c.key}
                                        className="px-2 py-1.5 text-slate-700 dark:text-slate-300"
                                      >
                                        {c.type === 'boolean'
                                          ? rd[c.key]
                                            ? '✓'
                                            : '—'
                                          : rd[c.key] == null || rd[c.key] === ''
                                            ? '—'
                                            : String(rd[c.key])}
                                      </td>
                                    ))}
                                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                                      <Link
                                        href={mergeHref(`/admin/data-sources/${src.id}`, sp, {
                                          editRow: r.id,
                                        })}
                                        className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                                      >
                                        Edit
                                      </Link>
                                      <form action={deleteRow} className="ml-1 inline">
                                        <input type="hidden" name="id" value={src.id} />
                                        <input type="hidden" name="rowId" value={r.id} />
                                        <button
                                          type="submit"
                                          className="rounded p-1 align-middle text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                                          title="Delete row"
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      </form>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <Pagination
                        basePath={`/admin/data-sources/${src.id}`}
                        currentParams={sp}
                        total={rowTotal}
                        page={rowParams.page}
                        perPage={rowParams.perPage}
                        pageParamKey="rowPage"
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Live data</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-600 dark:text-slate-400">
                  <p>
                    Rows come live from{' '}
                    {templateName ? <strong>{templateName}</strong> : 'the bound app'}
                    &apos;s submitted responses — there&apos;s nothing to enter here. Each response
                    is one row; columns mirror the app&apos;s fields.
                  </p>
                  <form action={resyncColumns}>
                    <input type="hidden" name="id" value={src.id} />
                    <Button type="submit" variant="outline" size="sm">
                      <RefreshCw size={14} /> Resync columns from app
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>

          {/* RIGHT: settings + columns */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Builder references ({usageAllTotal})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <TableToolbar>
                  <SearchInput
                    placeholder="Search app or field…"
                    paramKey="usageQ"
                    pageParamKey="usagePage"
                  />
                  <FilterChips
                    basePath={`/admin/data-sources/${src.id}`}
                    currentParams={sp}
                    paramKey="usageSort"
                    pageParamKey="usagePage"
                    label="Sort"
                    defaultValue="app"
                    hideAll
                    options={[
                      { value: 'app', label: 'App name' },
                      { value: 'fields', label: 'Field count' },
                    ]}
                  />
                </TableToolbar>
                {usage.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {usageAllTotal === 0
                      ? 'No Builder apps reference this source yet. Add a Lookup, Data table or KPI / chart element in the Builder and bind it to this key.'
                      : 'No Builder references match the search.'}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {usage.map((u) => (
                      <li
                        key={u.templateId}
                        className="rounded-md border border-slate-100 bg-slate-50/60 px-2.5 py-2 text-sm dark:border-slate-800 dark:bg-slate-900/80"
                      >
                        <Link
                          href={`/apps/templates/${u.templateId}/designer`}
                          className="font-medium text-teal-700 hover:underline dark:text-teal-300"
                        >
                          {u.templateName}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {u.fields.map((field) => (
                            <Badge key={field.fieldId} variant="outline" className="text-[10px]">
                              {field.fieldLabel}
                            </Badge>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <Pagination
                  basePath={`/admin/data-sources/${src.id}`}
                  currentParams={sp}
                  total={usageTotal}
                  page={usageParams.page}
                  perPage={usageParams.perPage}
                  pageParamKey="usagePage"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Settings</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={updateSource} className="space-y-3">
                  <input type="hidden" name="id" value={src.id} />
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name</Label>
                    <Input id="name" name="name" defaultValue={src.name} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      name="description"
                      rows={2}
                      defaultValue={src.description ?? ''}
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" size="sm">
                      Save
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Columns</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {cols.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No columns.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {cols.map((c) => (
                      <li
                        key={c.key}
                        className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50/60 px-2.5 py-1.5 text-sm dark:border-slate-800 dark:bg-slate-900/80"
                      >
                        <span className="min-w-0">
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {c.label}
                          </span>
                          <code className="ml-1.5 font-mono text-[11px] text-slate-400">
                            {c.key}
                          </code>
                          <Badge variant="outline" className="ml-1.5 text-[10px]">
                            {c.type}
                          </Badge>
                        </span>
                        {isReference ? (
                          <form action={deleteColumn} className="inline">
                            <input type="hidden" name="id" value={src.id} />
                            <input type="hidden" name="key" value={c.key} />
                            <button
                              type="submit"
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                              title="Remove column"
                            >
                              <Trash2 size={12} />
                            </button>
                          </form>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}

                {isReference ? (
                  <form
                    action={addColumn}
                    className="space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800"
                  >
                    <input type="hidden" name="id" value={src.id} />
                    <div className="grid grid-cols-[1fr_110px] gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-slate-500 dark:text-slate-400">
                          Label
                        </Label>
                        <Input name="label" required placeholder="e.g. Area" className="h-9" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-slate-500 dark:text-slate-400">
                          Type
                        </Label>
                        <Select name="type" defaultValue="text" className="h-9">
                          <option value="text">Text</option>
                          <option value="number">Number</option>
                          <option value="date">Date</option>
                          <option value="boolean">Yes/No</option>
                        </Select>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" size="sm" variant="outline">
                        <Plus size={14} /> Add column
                      </Button>
                    </div>
                  </form>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
