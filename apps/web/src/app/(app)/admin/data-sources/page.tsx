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

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Database, Plus, Trash2 } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Textarea,
  UrlDrawer,
} from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import {
  dataSourceRows,
  dataSources,
  formTemplateVersions,
  formTemplates,
  type DataSourceColumn,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { SortTh } from '@/components/sortable-th'
import { ListCard, MobileCardList } from '@/components/list-card'
import { mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { collectDataSourceUsage } from './_usage'
import { createDataSource, deleteDataSource } from './_actions'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0c4e106a6e0955') }
}
export const dynamic = 'force-dynamic'

const BASE = '/admin/data-sources'
const SORTS = ['name', 'key', 'kind', 'rows'] as const

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
  const drawerParam = pickString(sp.drawer)
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const closeHref = mergeHref(BASE, sp, { drawer: undefined })
  const newHref = mergeHref(BASE, sp, { drawer: 'new' })

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
    const rowTotals = tx
      .select({ dataSourceId: dataSourceRows.dataSourceId, total: count().as('row_total') })
      .from(dataSourceRows)
      .where(isNull(dataSourceRows.deletedAt))
      .groupBy(dataSourceRows.dataSourceId)
      .as('row_totals')
    const rowCount = sql<number>`coalesce(${rowTotals.total}, 0)`
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
      .leftJoin(rowTotals, eq(rowTotals.dataSourceId, dataSources.id))
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

  const description = [
    tGenerated('m_19367a67b2f407'),
    tGenerated('m_06a3cc6ad11fde'),
    tGenerated('m_03752d5e843bd8'),
    tGenerated('m_0c3df2423f6796'),
    tGenerated('m_05f499429b5e3b'),
  ].join(' ')

  return (
    <>
      <ListPageLayout
        header={
          <>
            <PageHeader
              title={tGenerated('m_0c4e106a6e0955')}
              description={description}
              back={{ href: '/admin', label: tGenerated('m_1301982c03f751') }}
              actions={
                <Link href={newHref as any} scroll={false}>
                  <Button>
                    <Plus size={14} /> <GeneratedText id="m_067f8ae9c23b03" />
                  </Button>
                </Link>
              }
            />
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
          </>
        }
      >
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
                action={
                  !params.q && !kindFilter ? (
                    <Link href={newHref as any} scroll={false}>
                      <Button>
                        <Plus size={14} /> <GeneratedText id="m_067f8ae9c23b03" />
                      </Button>
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <>
                <MobileCardList>
                  <GeneratedValue
                    value={sources.map((s) => (
                      <ListCard
                        key={s.id}
                        href={`/admin/data-sources/${s.id}`}
                        title={s.name}
                        status={
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
                        }
                        reference={s.key}
                        meta={
                          <>
                            <GeneratedValue
                              value={(s.columns as DataSourceColumn[])?.length ?? 0}
                            />{' '}
                            <GeneratedText id="m_1212b96e221372" />
                            {' · '}
                            <GeneratedValue
                              value={
                                s.kind === 'reference' ? (
                                  <>
                                    <GeneratedValue value={s.rowCount} />{' '}
                                    <GeneratedText id="m_19f38a950f87b6" />
                                  </>
                                ) : (
                                  <GeneratedText id="m_12b3d55ba24a1e" />
                                )
                              }
                            />
                          </>
                        }
                        footer={
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
                    ))}
                  />
                </MobileCardList>

                <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white sm:block dark:border-slate-800 dark:bg-slate-900">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                        <SortTh
                          basePath={BASE}
                          currentParams={sp}
                          column="name"
                          sort={params.sort}
                          dir={params.dir}
                        >
                          <GeneratedText id="m_02b18d5c7f6f2d" />
                        </SortTh>
                        <SortTh
                          basePath={BASE}
                          currentParams={sp}
                          column="key"
                          sort={params.sort}
                          dir={params.dir}
                        >
                          <GeneratedText id="m_169ff65a3cfc14" />
                        </SortTh>
                        <SortTh
                          basePath={BASE}
                          currentParams={sp}
                          column="kind"
                          sort={params.sort}
                          dir={params.dir}
                        >
                          <GeneratedText id="m_1e578efe1574cd" />
                        </SortTh>
                        <SortTh
                          basePath={BASE}
                          currentParams={sp}
                          column="rows"
                          sort={params.sort}
                          dir={params.dir}
                          align="right"
                        >
                          <GeneratedText id="m_03be2202673df4" />
                        </SortTh>
                        <th className="px-3 py-2">
                          <GeneratedText id="m_0b47933c7ed907" />
                        </th>
                        <th className="px-3 py-2 text-right">
                          <GeneratedText id="m_0a7f1858f2ec46" />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      <GeneratedValue
                        value={sources.map((s) => (
                          <tr
                            key={s.id}
                            className="hover:bg-slate-50/50 dark:hover:bg-slate-800/60"
                          >
                            <td className="px-3 py-2">
                              <Link
                                href={`/admin/data-sources/${s.id}` as any}
                                className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                              >
                                <GeneratedValue value={s.name} />
                              </Link>
                              <GeneratedValue
                                value={
                                  s.description ? (
                                    <div className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                                      <GeneratedValue value={s.description} />
                                    </div>
                                  ) : null
                                }
                              />
                            </td>
                            <td className="px-3 py-2">
                              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                {s.key}
                              </code>
                            </td>
                            <td className="px-3 py-2">
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
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600 tabular-nums dark:text-slate-300">
                              <GeneratedValue
                                value={
                                  s.kind === 'reference' ? (
                                    s.rowCount
                                  ) : (
                                    <GeneratedText id="m_12b3d55ba24a1e" />
                                  )
                                }
                              />
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                              <GeneratedValue
                                value={
                                  s.usage.length > 0 ? (
                                    <>
                                      <GeneratedText
                                        id="m_13e9bda7d0e936"
                                        values={{
                                          value0: s.usage.length,
                                          value1: s.usage.length === 1 ? '' : 's',
                                        }}
                                      />
                                      <div className="mt-0.5 line-clamp-1">
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
                                      </div>
                                    </>
                                  ) : (
                                    <GeneratedText id="m_11e7b314f53159" />
                                  )
                                }
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="inline-flex items-center gap-1">
                                <Link
                                  href={`/admin/data-sources/${s.id}` as any}
                                  className="rounded px-2 py-1 text-xs text-teal-700 hover:bg-teal-50 hover:underline dark:text-teal-400 dark:hover:bg-teal-500/10"
                                >
                                  <GeneratedText id="m_11d42075a22139" />
                                </Link>
                                <form action={deleteDataSource} className="inline">
                                  <input type="hidden" name="id" value={s.id} />
                                  <input type="hidden" name="redirect" value="list" />
                                  <button
                                    type="submit"
                                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                                    title={tGenerated('m_0371f0ff181098')}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </form>
                              </div>
                            </td>
                          </tr>
                        ))}
                      />
                    </tbody>
                  </table>
                </div>
              </>
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
      </ListPageLayout>

      <UrlDrawer
        open={drawerParam === 'new'}
        closeHref={closeHref}
        size="md"
        title={tGenerated('m_067f8ae9c23b03')}
        description={tGenerated('m_14bf1a9780b0be')}
      >
        <form action={createDataSource} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">
              <GeneratedText id="m_1a9978900838e6" />
            </Label>
            <Input id="name" name="name" required placeholder={tGenerated('m_16119cba7e6774')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kind">
              <GeneratedText id="m_1e578efe1574cd" />
            </Label>
            <Select id="kind" name="kind" defaultValue="reference">
              <option value="reference">{'Reference list — curated rows'}</option>
              <option value="responses">{"Live — an app's responses"}</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="templateId">
              <GeneratedText id="m_1bead7aa3a525a" />
            </Label>
            <Select id="templateId" name="templateId" defaultValue="" searchable>
              <option value="">—</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
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
          <p className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_0e81a3f5847bc6" />{' '}
            <strong>
              <GeneratedText id="m_0e29bca29fdf08" />
            </strong>
            ,{' '}
            <strong>
              <GeneratedText id="m_04482a5e9052cd" />
            </strong>{' '}
            <GeneratedText id="m_0e0bbc9cd7e263" />{' '}
            <strong>
              <GeneratedText id="m_14cd3ab6980600" />
            </strong>
            . <GeneratedText id="m_13487c6e4b895e" />
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button asChild variant="outline">
              <Link href={closeHref as any} scroll={false}>
                <GeneratedText id="m_112e2e8ecda428" />
              </Link>
            </Button>
            <Button type="submit">
              <Plus size={14} /> <GeneratedText id="m_017309f0f9f564" />
            </Button>
          </div>
        </form>
      </UrlDrawer>
    </>
  )
}
