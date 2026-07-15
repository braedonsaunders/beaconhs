import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0c4e106a6e0955') }
}
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
      if (ver?.schema) {
        columns = deriveColumnsFromSchema(
          ver.schema as FormSchemaV1,
          ctx.defaultLocale,
          ctx.defaultLocale,
        )
      }
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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
    const usageBySource = collectDataSourceUsage(versionRows, ctx.locale, ctx.defaultLocale)

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
              <GeneratedText id="m_0c4e106a6e0955" />
            </h1>
          </div>
          <p className="max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_19367a67b2f407" />{' '}
            <strong>
              <GeneratedText id="m_06a3cc6ad11fde" />
            </strong>{' '}
            <GeneratedText id="m_03752d5e843bd8" />{' '}
            <strong>
              <GeneratedText id="m_0c3df2423f6796" />
            </strong>{' '}
            <GeneratedText id="m_05f499429b5e3b" />
          </p>
        </header>

        <TableToolbar>
          <SearchInput placeholder={tGenerated('m_0f50a3cdc5da0c')} />
          <FilterChips
            basePath={BASE}
            currentParams={sp}
            paramKey="kind"
            label={tGenerated('m_1e578efe1574cd')}
            options={[
              { value: 'reference', label: 'Reference', count: kindCounts.reference ?? 0 },
              { value: 'responses', label: 'Live responses', count: kindCounts.responses ?? 0 },
            ]}
          />
          <FilterChips
            basePath={BASE}
            currentParams={sp}
            paramKey="sort"
            label={tGenerated('m_02801f1ab429b3')}
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
            <GeneratedValue
              value={
                sources.length === 0 ? (
                  <EmptyState
                    icon={<Database size={32} />}
                    title={tGeneratedValue(
                      !params.q && !kindFilter
                        ? tGenerated('m_087ed664b97151')
                        : tGenerated('m_1d4c9bb824f08b'),
                    )}
                    description={tGeneratedValue(
                      !params.q && !kindFilter
                        ? tGenerated('m_14bf1a9780b0be')
                        : tGenerated('m_169279e9abc526'),
                    )}
                  />
                ) : (
                  <ul className="space-y-3">
                    <GeneratedValue
                      value={sources.map((s) => (
                        <li
                          key={s.id}
                          className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-700"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <Link href={`/admin/data-sources/${s.id}`} className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-slate-900 dark:text-slate-100">
                                  <GeneratedValue value={s.name} />
                                </span>
                                <Badge variant={s.kind === 'responses' ? 'secondary' : 'outline'}>
                                  <GeneratedValue
                                    value={
                                      s.kind === 'responses' ? (
                                        <GeneratedText id="m_0ab332b0cc2c05" />
                                      ) : (
                                        <GeneratedText id="m_17dc61a19b605c" />
                                      )
                                    }
                                  />
                                </Badge>
                                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                  {s.key}
                                </code>
                              </div>
                              <GeneratedValue
                                value={
                                  s.description ? (
                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                      <GeneratedValue value={s.description} />
                                    </p>
                                  ) : null
                                }
                              />
                              <p className="mt-1.5 flex items-center gap-3 text-xs text-slate-400">
                                <span className="inline-flex items-center gap-1">
                                  <Table2 size={12} />
                                  <GeneratedValue
                                    value={(s.columns as DataSourceColumn[])?.length ?? 0}
                                  />{' '}
                                  <GeneratedText id="m_1212b96e221372" />
                                </span>
                                <GeneratedValue
                                  value={
                                    s.kind === 'reference' ? (
                                      <span>
                                        <GeneratedValue value={s.rowCount} />{' '}
                                        <GeneratedText id="m_19f38a950f87b6" />
                                      </span>
                                    ) : (
                                      <span>
                                        <GeneratedText id="m_12b3d55ba24a1e" />
                                      </span>
                                    )
                                  }
                                />
                                <span>
                                  <GeneratedValue
                                    value={
                                      s.usage.length > 0 ? (
                                        <GeneratedText
                                          id="m_13e9bda7d0e936"
                                          values={{
                                            value0: s.usage.length,
                                            value1: s.usage.length === 1 ? '' : 's',
                                          }}
                                        />
                                      ) : (
                                        <GeneratedText id="m_11e7b314f53159" />
                                      )
                                    }
                                  />
                                </span>
                                <span className="inline-flex items-center gap-0.5 text-teal-600 opacity-0 transition group-hover:opacity-100">
                                  <GeneratedText id="m_11d42075a22139" /> <ArrowUpRight size={12} />
                                </span>
                              </p>
                              <GeneratedValue
                                value={
                                  s.usage.length > 0 ? (
                                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                      <GeneratedValue
                                        value={s.usage
                                          .slice(0, 2)
                                          .map((u) => u.templateName)
                                          .join(', ')}
                                      />
                                      <GeneratedValue
                                        value={
                                          s.usage.length > 2 ? (
                                            <GeneratedText
                                              id="m_08e3645be30703"
                                              values={{ value0: s.usage.length - 2 }}
                                            />
                                          ) : (
                                            ''
                                          )
                                        }
                                      />
                                    </p>
                                  ) : null
                                }
                              />
                            </Link>
                            <form action={deleteDataSource}>
                              <input type="hidden" name="id" value={s.id} />
                              <button
                                type="submit"
                                className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                                title={tGenerated('m_0371f0ff181098')}
                              >
                                <Trash2 size={15} />
                              </button>
                            </form>
                          </div>
                        </li>
                      ))}
                    />
                  </ul>
                )
              }
            />
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>
                  <GeneratedText id="m_067f8ae9c23b03" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form action={createDataSource} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">
                      <GeneratedText id="m_1a9978900838e6" />
                    </Label>
                    <Input
                      id="name"
                      name="name"
                      required
                      placeholder={tGenerated('m_16119cba7e6774')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="kind">
                      <GeneratedText id="m_1e578efe1574cd" />
                    </Label>
                    <Select id="kind" name="kind" defaultValue="reference">
                      <option value="reference">
                        <GeneratedText id="m_1f6869e6d0f14d" />
                      </option>
                      <option value="responses">
                        <GeneratedText id="m_18e1eb9bd16825" />
                      </option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="templateId">
                      <GeneratedText id="m_1bead7aa3a525a" />
                    </Label>
                    <Select id="templateId" name="templateId" defaultValue="" searchable>
                      <option value="">—</option>
                      <GeneratedValue
                        value={templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            <GeneratedValue value={t.name} />
                          </option>
                        ))}
                      />
                    </Select>
                    <p className="text-xs text-slate-400">
                      <GeneratedText id="m_0c34299f39bfc2" />{' '}
                      <em>
                        <GeneratedText id="m_17d18603d1b603" />
                      </em>{' '}
                      <GeneratedText id="m_03d05f636b2733" />
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="description">
                      <GeneratedText id="m_14d923495cf14c" />
                    </Label>
                    <Textarea id="description" name="description" rows={2} />
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit">
                      <Plus size={14} /> <GeneratedText id="m_017309f0f9f564" />
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <GeneratedText id="m_01f43afd444ea5" />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <p>
                  <GeneratedText id="m_0e81a3f5847bc6" />{' '}
                  <strong>
                    <GeneratedText id="m_0e29bca29fdf08" />
                  </strong>
                  ,{' '}
                  <strong>
                    <GeneratedText id="m_04482a5e9052cd" />
                  </strong>{' '}
                  <GeneratedText id="m_0e0bbc9cd7e263" />
                  <GeneratedValue value={' '} />
                  <strong>
                    <GeneratedText id="m_14cd3ab6980600" />
                  </strong>{' '}
                  <GeneratedText id="m_07c97f1f61314b" />
                </p>
                <p>
                  <GeneratedText id="m_13487c6e4b895e" />
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
