// /admin/data-sources/[id] — manage one data source: its column shape + (for
// reference kind) its rows. For responses kind, columns are snapshotted from
// the bound app and rows are live, so only a "resync columns" action is shown.

import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { asc, desc, eq, isNull, sql } from 'drizzle-orm'
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
import { deriveColumnsFromSchema, slugify } from '../_shared'

export const metadata = { title: 'Data source' }
export const dynamic = 'force-dynamic'

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

  await ctx.db(async (tx) => {
    const [src] = await tx
      .select({ columns: dataSources.columns })
      .from(dataSources)
      .where(eq(dataSources.id, id))
      .limit(1)
    if (!src) return
    const cols = (src.columns as DataSourceColumn[]) ?? []
    if (cols.some((c) => c.key === key)) return
    await tx
      .update(dataSources)
      .set({ columns: [...cols, { key, label, type }] })
      .where(eq(dataSources.id, id))
  })
  revalidatePath(`/admin/data-sources/${id}`)
}

async function deleteColumn(formData: FormData): Promise<void> {
  'use server'
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  const key = String(formData.get('key') ?? '')
  if (!id || !key) return
  await ctx.db(async (tx) => {
    const [src] = await tx
      .select({ columns: dataSources.columns })
      .from(dataSources)
      .where(eq(dataSources.id, id))
      .limit(1)
    if (!src) return
    const cols = ((src.columns as DataSourceColumn[]) ?? []).filter((c) => c.key !== key)
    await tx.update(dataSources).set({ columns: cols }).where(eq(dataSources.id, id))
  })
  revalidatePath(`/admin/data-sources/${id}`)
}

async function resyncColumns(formData: FormData): Promise<void> {
  'use server'
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db(async (tx) => {
    const [src] = await tx
      .select({ config: dataSources.config })
      .from(dataSources)
      .where(eq(dataSources.id, id))
      .limit(1)
    const templateId = src?.config?.templateId
    if (!templateId) return
    const [ver] = await tx
      .select({ schema: formTemplateVersions.schema })
      .from(formTemplateVersions)
      .where(eq(formTemplateVersions.templateId, templateId))
      .orderBy(desc(formTemplateVersions.version))
      .limit(1)
    if (!ver?.schema) return
    await tx
      .update(dataSources)
      .set({ columns: deriveColumnsFromSchema(ver.schema as FormSchemaV1) })
      .where(eq(dataSources.id, id))
  })
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
  await ctx.db(async (tx) => {
    const [src] = await tx
      .select({ columns: dataSources.columns })
      .from(dataSources)
      .where(eq(dataSources.id, id))
      .limit(1)
    if (!src) return
    const cols = (src.columns as DataSourceColumn[]) ?? []
    const data = readRowData(formData, cols)
    const [{ p } = { p: 0 }] = await tx
      .select({ p: sql<number>`coalesce(max(${dataSourceRows.position}), 0)` })
      .from(dataSourceRows)
      .where(eq(dataSourceRows.dataSourceId, id))
    await tx
      .insert(dataSourceRows)
      .values({ tenantId: ctx.tenantId, dataSourceId: id, data, position: Number(p ?? 0) + 10 })
  })
  revalidatePath(`/admin/data-sources/${id}`)
}

async function updateRow(formData: FormData): Promise<void> {
  'use server'
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  if (!id || !rowId) return
  await ctx.db(async (tx) => {
    const [src] = await tx
      .select({ columns: dataSources.columns })
      .from(dataSources)
      .where(eq(dataSources.id, id))
      .limit(1)
    if (!src) return
    const cols = (src.columns as DataSourceColumn[]) ?? []
    const data = readRowData(formData, cols)
    await tx.update(dataSourceRows).set({ data }).where(eq(dataSourceRows.id, rowId))
  })
  revalidatePath(`/admin/data-sources/${id}`)
}

async function deleteRow(formData: FormData): Promise<void> {
  'use server'
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  if (!id || !rowId) return
  await ctx.db((tx) =>
    tx.update(dataSourceRows).set({ deletedAt: new Date() }).where(eq(dataSourceRows.id, rowId)),
  )
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
  const sp = await searchParams
  const editingRow = typeof sp.editRow === 'string' ? sp.editRow : undefined
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')

  const data = await ctx.db(async (tx) => {
    const [src] = await tx.select().from(dataSources).where(eq(dataSources.id, id)).limit(1)
    if (!src || src.deletedAt) return null
    const rows =
      src.kind === 'reference'
        ? await tx
            .select({ id: dataSourceRows.id, data: dataSourceRows.data })
            .from(dataSourceRows)
            .where(eq(dataSourceRows.dataSourceId, id))
            .orderBy(asc(dataSourceRows.position))
        : []
    let templateName: string | null = null
    if (src.kind === 'responses' && src.config?.templateId) {
      const [t] = await tx
        .select({ name: formTemplates.name })
        .from(formTemplates)
        .where(eq(formTemplates.id, src.config.templateId))
        .limit(1)
      templateName = t?.name ?? null
    }
    return { src, rows, templateName }
  })

  if (!data) notFound()
  const { src, rows, templateName } = data
  const cols = (src.columns as DataSourceColumn[]) ?? []
  const isReference = src.kind === 'reference'

  return (
    <PageContainer>
      <div className="space-y-6">
        <div>
          <Link
            href="/admin/data-sources"
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft size={14} /> Data sources
          </Link>
        </div>

        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-slate-900">{src.name}</h1>
              <Badge variant={isReference ? 'outline' : 'secondary'}>
                {isReference ? 'Reference' : 'Live responses'}
              </Badge>
            </div>
            <p className="text-sm text-slate-500">
              Key{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
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
                  <span className="text-xs text-slate-400">{rows.length} total</span>
                </CardHeader>
                <CardContent>
                  {cols.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      Add columns first (right) — then you can add rows.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {/* Add-row form */}
                      <form
                        action={addRow}
                        className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-2.5"
                      >
                        <input type="hidden" name="id" value={src.id} />
                        {cols.map((c) => (
                          <div key={c.key} className="space-y-1">
                            <Label className="text-[11px] text-slate-500">{c.label}</Label>
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

                      {rows.length === 0 ? (
                        <EmptyState
                          icon={<Plus size={28} />}
                          title="No rows"
                          description="Use the form above to add a row."
                        />
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-slate-200 text-left text-xs tracking-wide text-slate-400 uppercase">
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
                                      className="border-b border-slate-100 bg-teal-50/30"
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
                                              <Label className="text-[11px] text-slate-500">
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
                                            href={`/admin/data-sources/${src.id}`}
                                            className="px-1 text-sm text-slate-500 hover:underline"
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
                                    className="border-b border-slate-100 hover:bg-slate-50/60"
                                  >
                                    {cols.map((c) => (
                                      <td key={c.key} className="px-2 py-1.5 text-slate-700">
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
                                        href={`/admin/data-sources/${src.id}?editRow=${r.id}`}
                                        className="text-xs text-teal-700 hover:underline"
                                      >
                                        Edit
                                      </Link>
                                      <form action={deleteRow} className="ml-1 inline">
                                        <input type="hidden" name="id" value={src.id} />
                                        <input type="hidden" name="rowId" value={r.id} />
                                        <button
                                          type="submit"
                                          className="rounded p-1 align-middle text-slate-400 hover:bg-red-50 hover:text-red-700"
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
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Live data</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-slate-600">
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
                  <p className="text-sm text-slate-500">No columns.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {cols.map((c) => (
                      <li
                        key={c.key}
                        className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50/60 px-2.5 py-1.5 text-sm"
                      >
                        <span className="min-w-0">
                          <span className="font-medium text-slate-800">{c.label}</span>
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
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700"
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
                  <form action={addColumn} className="space-y-2 border-t border-slate-100 pt-3">
                    <input type="hidden" name="id" value={src.id} />
                    <div className="grid grid-cols-[1fr_110px] gap-2">
                      <div className="space-y-1">
                        <Label className="text-[11px] text-slate-500">Label</Label>
                        <Input name="label" required placeholder="e.g. Area" className="h-9" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] text-slate-500">Type</Label>
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
