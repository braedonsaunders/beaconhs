// /admin/data-sources — tenant admins curate the DATA SOURCES that data-bound
// app elements (lookup, cascading dropdowns, data-table, KPI/chart) read from.
//
// Two kinds:
//   - reference: hand-curated rows (managed on the detail page).
//   - responses: live rows derived from a chosen app's submitted responses;
//     columns are snapshotted from that app's fields on creation.
//
// Gated by admin.settings.manage (same tier as AI providers). All mutations
// recordAudit (entityType='data_source').

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Database, Plus, Table2, Trash2, ArrowUpRight } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
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
} from '@beaconhs/db/schema'
import type { FormSchemaV1 } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { parseListParams, pickString } from '@/lib/list-params'
import { AdminBackLink } from '../_back-link'
import { deriveColumnsFromSchema, slugify } from './_shared'
import { collectDataSourceUsage } from './_usage'

export const metadata = { title: 'Data sources' }
export const dynamic = 'force-dynamic'

const BASE = '/admin/data-sources'
const SORTS = ['name', 'key', 'kind', 'rows'] as const

async function createDataSource(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) return
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  const kind = formData.get('kind') === 'responses' ? 'responses' : 'reference'
  const templateId = String(formData.get('templateId') ?? '').trim() || null
  const description = String(formData.get('description') ?? '').trim() || null

  // Unique, stable slug per tenant. Append a counter on collision.
  const base = slugify(String(formData.get('key') ?? '').trim() || name)
  const newId = await ctx.db(async (tx) => {
    const existing = await tx
      .select({ key: dataSources.key })
      .from(dataSources)
      .where(isNull(dataSources.deletedAt))
    const taken = new Set(existing.map((r) => r.key))
    let key = base
    let n = 2
    while (taken.has(key)) key = `${base}-${n++}`

    // For a responses-kind source, snapshot columns from the chosen app's
    // latest schema so metric/groupBy editors have fields to offer.
    let columns: DataSourceColumn[] = []
    let config: { templateId?: string } = {}
    if (kind === 'responses' && templateId) {
      const [ver] = await tx
        .select({ schema: formTemplateVersions.schema })
        .from(formTemplateVersions)
        .where(eq(formTemplateVersions.templateId, templateId))
        .orderBy(desc(formTemplateVersions.version))
        .limit(1)
      if (ver?.schema) columns = deriveColumnsFromSchema(ver.schema as FormSchemaV1)
      config = { templateId }
    }

    const [row] = await tx
      .insert(dataSources)
      .values({
        tenantId: ctx.tenantId,
        key,
        name,
        description,
        kind,
        columns,
        config,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: dataSources.id })
    return row?.id ?? null
  })

  if (newId) {
    await recordAudit(ctx, {
      entityType: 'data_source',
      entityId: newId,
      action: 'create',
      summary: `Created data source "${name}" (${kind})`,
      after: { name, kind },
    })
    revalidatePath('/admin/data-sources')
    redirect(`/admin/data-sources/${newId}`)
  }
  revalidatePath('/admin/data-sources')
}

async function deleteDataSource(formData: FormData): Promise<void> {
  'use server'
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) return
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db((tx) =>
    tx.update(dataSources).set({ deletedAt: new Date() }).where(eq(dataSources.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'data_source',
    entityId: id,
    action: 'delete',
    summary: 'Deleted data source',
  })
  revalidatePath('/admin/data-sources')
}

export default async function DataSourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')
  const sp = await searchParams
  const kindParam = pickString(sp.kind)
  const kindFilter = kindParam === 'reference' || kindParam === 'responses' ? kindParam : undefined
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })

  const { sources, templates, total, kindCounts } = await ctx.db(async (tx) => {
    const search: SQL<unknown> | undefined = params.q
      ? or(
          ilike(dataSources.name, `%${params.q}%`),
          ilike(dataSources.key, `%${params.q}%`),
          ilike(dataSources.description, `%${params.q}%`),
        )
      : undefined
    const active = isNull(dataSources.deletedAt)
    const where = and(active, search, kindFilter ? eq(dataSources.kind, kindFilter) : undefined)
    const rowCount = sql<number>`(select count(*) from ${dataSourceRows} where ${dataSourceRows.dataSourceId} = ${dataSources.id} and ${dataSourceRows.deletedAt} is null)`
    const dirFn = params.dir === 'asc' ? asc : desc
    const orderBy =
      params.sort === 'key'
        ? [dirFn(dataSources.key)]
        : params.sort === 'kind'
          ? [dirFn(dataSources.kind), asc(dataSources.name)]
          : params.sort === 'rows'
            ? [dirFn(rowCount), asc(dataSources.name)]
            : [dirFn(dataSources.name)]
    const all = await tx
      .select({
        id: dataSources.id,
        key: dataSources.key,
        name: dataSources.name,
        description: dataSources.description,
        kind: dataSources.kind,
        columns: dataSources.columns,
        config: dataSources.config,
        rowCount,
      })
      .from(dataSources)
      .where(where)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const tmpls = await tx
      .select({ id: formTemplates.id, name: formTemplates.name })
      .from(formTemplates)
      .where(isNull(formTemplates.deletedAt))
      .orderBy(asc(formTemplates.name))
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
    const usageBySource = collectDataSourceUsage(versionRows)

    const [totalRow, kindRows] = await Promise.all([
      tx.select({ c: count() }).from(dataSources).where(where),
      tx
        .select({ kind: dataSources.kind, c: count() })
        .from(dataSources)
        .where(and(active, search))
        .groupBy(dataSources.kind),
    ])
    return {
      sources: all.map((s) => ({
        ...s,
        rowCount: Number(s.rowCount),
        usage: usageBySource.get(s.key) ?? [],
      })),
      templates: tmpls,
      total: Number(totalRow[0]?.c ?? 0),
      kindCounts: Object.fromEntries(kindRows.map((row) => [row.kind, Number(row.c)])),
    }
  })

  return (
    <PageContainer>
      <AdminBackLink />
      <div className="space-y-8">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <Database size={22} className="text-teal-600" />
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              Data sources
            </h1>
          </div>
          <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Reusable lists + live data that your apps bind to — for lookup auto-fill, cascading
            dropdowns, data tables and KPI / chart blocks. Build a <strong>reference</strong> list
            by hand, or surface an app&apos;s <strong>responses</strong> as live data.
          </p>
        </header>

        <TableToolbar>
          <SearchInput placeholder="Search name, key, or description…" />
          <FilterChips
            basePath={BASE}
            currentParams={sp}
            paramKey="kind"
            label="Kind"
            options={[
              { value: 'reference', label: 'Reference', count: kindCounts.reference ?? 0 },
              { value: 'responses', label: 'Live responses', count: kindCounts.responses ?? 0 },
            ]}
          />
          <FilterChips
            basePath={BASE}
            currentParams={sp}
            paramKey="sort"
            label="Sort"
            defaultValue="name"
            hideAll
            options={[
              { value: 'name', label: 'Name' },
              { value: 'key', label: 'Key' },
              { value: 'kind', label: 'Kind' },
              { value: 'rows', label: 'Row count' },
            ]}
          />
        </TableToolbar>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-3">
            {sources.length === 0 ? (
              <EmptyState
                icon={<Database size={32} />}
                title={!params.q && !kindFilter ? 'No data sources' : 'No matching data sources'}
                description={
                  !params.q && !kindFilter
                    ? "Create a reference list (e.g. Sites → Areas) or surface an app's responses as live data."
                    : 'Adjust the search or kind filter.'
                }
              />
            ) : (
              <ul className="space-y-3">
                {sources.map((s) => (
                  <li
                    key={s.id}
                    className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-700"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/admin/data-sources/${s.id}`} className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {s.name}
                          </span>
                          <Badge variant={s.kind === 'responses' ? 'secondary' : 'outline'}>
                            {s.kind === 'responses' ? 'Live responses' : 'Reference'}
                          </Badge>
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            {s.key}
                          </code>
                        </div>
                        {s.description ? (
                          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            {s.description}
                          </p>
                        ) : null}
                        <p className="mt-1.5 flex items-center gap-3 text-xs text-slate-400">
                          <span className="inline-flex items-center gap-1">
                            <Table2 size={12} />
                            {(s.columns as DataSourceColumn[])?.length ?? 0} columns
                          </span>
                          {s.kind === 'reference' ? (
                            <span>{s.rowCount} rows</span>
                          ) : (
                            <span>live</span>
                          )}
                          <span>
                            {s.usage.length > 0
                              ? `used by ${s.usage.length} app${s.usage.length === 1 ? '' : 's'}`
                              : 'not referenced yet'}
                          </span>
                          <span className="inline-flex items-center gap-0.5 text-teal-600 opacity-0 transition group-hover:opacity-100">
                            Manage <ArrowUpRight size={12} />
                          </span>
                        </p>
                        {s.usage.length > 0 ? (
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {s.usage
                              .slice(0, 2)
                              .map((u) => u.templateName)
                              .join(', ')}
                            {s.usage.length > 2 ? ` +${s.usage.length - 2} more` : ''}
                          </p>
                        ) : null}
                      </Link>
                      <form action={deleteDataSource}>
                        <input type="hidden" name="id" value={s.id} />
                        <button
                          type="submit"
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                          title="Delete data source"
                        >
                          <Trash2 size={15} />
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>New data source</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={createDataSource} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Name *</Label>
                    <Input id="name" name="name" required placeholder="e.g. Sites" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="kind">Kind</Label>
                    <Select id="kind" name="kind" defaultValue="reference">
                      <option value="reference">Reference list — curated rows</option>
                      <option value="responses">Live — an app&apos;s responses</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="templateId">Source app (for live)</Label>
                    <Select id="templateId" name="templateId" defaultValue="" searchable>
                      <option value="">—</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                    <p className="text-xs text-slate-400">
                      Only used for the <em>Live</em> kind. Columns are snapshotted from the
                      app&apos;s fields.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="description">Description</Label>
                    <Textarea id="description" name="description" rows={2} />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit">
                      <Plus size={14} /> Create
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>How apps use these</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <p>
                  In the app builder, add a <strong>Lookup</strong>, <strong>Data table</strong> or{' '}
                  <strong>KPI / chart</strong> element and bind it to a source here.
                </p>
                <p>
                  Cascading dropdowns (Site → Area → Sub-area) work by filtering one lookup&apos;s
                  rows by another field&apos;s value.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
        <Pagination
          basePath={BASE}
          currentParams={sp}
          total={total}
          page={params.page}
          perPage={params.perPage}
        />
      </div>
    </PageContainer>
  )
}
