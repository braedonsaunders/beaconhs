import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, count, desc, eq, inArray, type SQL } from 'drizzle-orm'
import { ArrowUpRight, Download, ShieldCheck } from 'lucide-react'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  UrlDrawer,
} from '@beaconhs/ui'
import { can, type RequestContext } from '@beaconhs/tenant'
import {
  formResponses,
  formTemplateVersions,
  formTemplates,
  type FormSchemaV1,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { Pagination } from '@/components/pagination'
import { buildHref, mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { getEffectiveRoleKeys } from '@/lib/effective-roles'
import { buildResponseExportColumns } from '@/app/(app)/apps/responses/_export-columns'
import { templateAccessWhere } from '@/app/(app)/apps/_lib/access'
import {
  EXPORTABLE_ENTITIES,
  EXPORT_GROUPS,
  EXPORT_SORT_DIRECTIONS,
  type ExportEntity,
  type ExportFilterControl,
} from './_entities'
import { ExportSourcesTable } from './_sources-table'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1a4acd935141a8') }
}
export const dynamic = 'force-dynamic'

const BASE = '/admin/export'
const SORTS = ['label', 'group', 'sensitivity'] as const

const SENSITIVITY_OPTIONS = [
  { value: 'Standard', label: 'Standard' },
  { value: 'Sensitive', label: 'Sensitive' },
  { value: 'Restricted', label: 'Restricted' },
] as const

const FORM_RESPONSE_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'in_review', label: 'In review' },
  { value: 'closed', label: 'Closed' },
  { value: 'rejected', label: 'Rejected' },
] as const

function canUseEntity(ctx: RequestContext, entity: ExportEntity): boolean {
  return (
    entity.permissionAny.length === 0 ||
    entity.permissionAny.some((permission) => can(ctx, permission))
  )
}

function matchesQuery(entity: ExportEntity, q: string | undefined): boolean {
  if (!q) return true
  const haystack = [
    entity.label,
    entity.description,
    entity.groupLabel,
    entity.ownerLabel,
    entity.defaultScope,
    entity.defaultSort,
    ...entity.filterSummary,
    ...entity.columns.map((column) => column.label),
    ...entity.columns.map((column) => column.description ?? ''),
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(q.toLowerCase())
}

export default async function ExportHubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.data.export')) notFound()

  const sp = await searchParams
  const q = pickString(sp.q)?.trim() || undefined
  const groupFilter = pickString(sp.group)
  const sensitivityFilter = pickString(sp.sensitivity)
  const sourceKey = pickString(sp.source)
  const listParams = parseListParams(sp, {
    sort: 'label',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })

  const dynamicEntities = await loadBuilderAppExportEntities(ctx)
  const availableEntities = [...EXPORTABLE_ENTITIES, ...dynamicEntities].filter((entity) =>
    canUseEntity(ctx, entity),
  )
  const filteredEntities = availableEntities.filter(
    (entity) =>
      matchesQuery(entity, q) &&
      (!groupFilter || entity.groupLabel === groupFilter) &&
      (!sensitivityFilter || entity.sensitivity === sensitivityFilter),
  )
  const sortedEntities = [...filteredEntities].sort((a, b) => {
    const mult = listParams.dir === 'asc' ? 1 : -1
    if (listParams.sort === 'group') {
      return (a.groupLabel.localeCompare(b.groupLabel) || a.label.localeCompare(b.label)) * mult
    }
    if (listParams.sort === 'sensitivity') {
      return (a.sensitivity.localeCompare(b.sensitivity) || a.label.localeCompare(b.label)) * mult
    }
    return a.label.localeCompare(b.label) * mult
  })
  const pageEntities = sortedEntities.slice(
    (listParams.page - 1) * listParams.perPage,
    listParams.page * listParams.perPage,
  )
  const selectedSource = sourceKey
    ? (availableEntities.find((entity) => entity.key === sourceKey) ?? null)
    : null
  const closeHref = mergeHref(BASE, sp, { source: undefined })
  const groupCounts = new Map(
    EXPORT_GROUPS.map((group) => [
      group.label,
      availableEntities.filter((entity) => entity.groupLabel === group.label).length,
    ]),
  )
  const sensitivityCounts = new Map(
    SENSITIVITY_OPTIONS.map((option) => [
      option.value,
      availableEntities.filter((entity) => entity.sensitivity === option.value).length,
    ]),
  )
  const canReadAudit = can(ctx, 'admin.audit.read')

  return (
    <>
      <ListPageLayout
        header={
          <>
            <PageHeader
              title={tGenerated('m_1a4acd935141a8')}
              description={tGenerated('m_09ae444bd5691b')}
              back={{ href: '/admin', label: 'Admin' }}
              actions={
                canReadAudit ? (
                  <Button asChild variant="outline">
                    <Link href="/admin/audit">
                      <ShieldCheck size={14} className="mr-1.5" />
                      <GeneratedText id="m_19635ea35a756a" />
                    </Link>
                  </Button>
                ) : null
              }
            />
            <TableToolbar
              trailing={
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  <GeneratedValue value={filteredEntities.length} />{' '}
                  <GeneratedText id="m_00e704d1194796" />{' '}
                  <GeneratedValue value={availableEntities.length} />{' '}
                  <GeneratedText id="m_1c0cef8c914131" />
                </div>
              }
            >
              <SearchInput placeholder={tGenerated('m_191199c7599768')} />
              <FilterChips
                basePath={BASE}
                currentParams={sp}
                paramKey="group"
                label={tGenerated('m_0d06af9d4c7f60')}
                options={EXPORT_GROUPS.map((group) => ({
                  value: group.label,
                  label: group.label,
                  count: groupCounts.get(group.label) ?? 0,
                }))}
              />
              <FilterChips
                basePath={BASE}
                currentParams={sp}
                paramKey="sensitivity"
                label={tGenerated('m_12de0a8fa81d16')}
                options={SENSITIVITY_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                  count: sensitivityCounts.get(option.value) ?? 0,
                }))}
              />
              <FilterChips
                basePath={BASE}
                currentParams={sp}
                paramKey="sort"
                label={tGenerated('m_02801f1ab429b3')}
                defaultValue="label"
                hideAll
                options={[
                  { value: 'label', label: 'Name' },
                  { value: 'group', label: 'Group' },
                  { value: 'sensitivity', label: 'Sensitivity' },
                ]}
              />
            </TableToolbar>
          </>
        }
      >
        <GeneratedValue
          value={
            pageEntities.length === 0 ? (
              <EmptyState
                icon={<Download size={32} />}
                title={tGenerated('m_1d4c9bb824f08b')}
                description={tGenerated('m_17c2b94612a729')}
              />
            ) : (
              <ExportSourcesTable
                entities={pageEntities}
                currentParams={sp}
                selectedKey={selectedSource?.key}
              />
            )
          }
        />
        <Pagination
          basePath={BASE}
          currentParams={sp}
          total={filteredEntities.length}
          page={listParams.page}
          perPage={listParams.perPage}
        />
      </ListPageLayout>

      <UrlDrawer
        open={!!selectedSource}
        closeHref={closeHref}
        size="lg"
        title={tGeneratedValue(selectedSource?.label ?? tGenerated('m_1e51e17fccd721'))}
        description={tGeneratedValue(
          selectedSource
            ? `${selectedSource.ownerLabel} / ${selectedSource.defaultScope}`
            : undefined,
        )}
      >
        <GeneratedValue
          value={selectedSource ? <ExportSourceDrawer entity={selectedSource} /> : null}
        />
      </UrlDrawer>
    </>
  )
}

function ExportSourceDrawer({ entity }: { entity: ExportEntity }) {
  const tGenerated = useGeneratedTranslations()
  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              <GeneratedText id="m_1e51e17fccd721" />
            </div>
            <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              <GeneratedValue value={entity.description} />
            </p>
          </div>
          <Badge
            variant={
              entity.sensitivity === 'Restricted'
                ? 'destructive'
                : entity.sensitivity === 'Sensitive'
                  ? 'warning'
                  : 'secondary'
            }
          >
            <GeneratedValue value={entity.sensitivity} />
          </Badge>
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <DrawerFact label={tGenerated('m_065b964e065bf7')} value={entity.ownerLabel} />
          <DrawerFact label={tGenerated('m_1f10a46fc1db73')} value={entity.defaultScope} />
          <DrawerFact label={tGenerated('m_1e63c44e9357c6')} value={entity.rowLimit} />
          <DrawerFact label={tGenerated('m_184e33c0ff4633')} value={entity.defaultSort} />
        </dl>
        <div className="mt-4">
          <Link
            href={entity.sourceHref as any}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:text-teal-800 hover:underline dark:text-teal-300 dark:hover:text-teal-200"
          >
            <ArrowUpRight size={14} />
            <GeneratedText id="m_1743f02da013fa" />
          </Link>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            <GeneratedText id="m_186693a97dd2f5" />
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            <GeneratedText id="m_164e1113558346" />
          </p>
        </div>
        <form action={entity.formActionHref ?? entity.csvHref} method="get" className="space-y-4">
          <GeneratedValue
            value={Object.entries(entity.fixedParams ?? {}).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
          />
          <GeneratedValue
            value={
              entity.filters.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <GeneratedValue
                    value={entity.filters.map((filter) => (
                      <ExportFilterField key={filter.name} entityKey={entity.key} filter={filter} />
                    ))}
                  />
                </div>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  <GeneratedText id="m_1db345dd13681b" />
                </p>
              )
            }
          />

          <GeneratedValue
            value={
              entity.sortOptions.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`${entity.key}-sort`}>
                      <GeneratedText id="m_0843a08505c249" />
                    </Label>
                    <Select
                      id={`${entity.key}-sort`}
                      name="sort"
                      placeholder={tGenerated('m_184e33c0ff4633')}
                    >
                      <option value="">{'Default sort'}</option>
                      {entity.sortOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${entity.key}-dir`}>
                      <GeneratedText id="m_18c1dfa678c34a" />
                    </Label>
                    <Select
                      id={`${entity.key}-dir`}
                      name="dir"
                      placeholder={tGenerated('m_1a98e5887ce38c')}
                    >
                      <option value="">{'Default direction'}</option>
                      {EXPORT_SORT_DIRECTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              ) : null
            }
          />

          <div className="rounded-md border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  <GeneratedText id="m_04eacfda3069db" />
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  <GeneratedValue value={entity.columns.length} />{' '}
                  <GeneratedText id="m_07f3277d9a6d8e" />
                </p>
              </div>
              <Badge variant="secondary">
                <GeneratedValue value={entity.columns.length} />
              </Badge>
            </div>
            <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              <GeneratedValue
                value={entity.columns.map((column) => (
                  <label
                    key={column.key}
                    className="flex min-w-0 items-start gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <input
                      type="checkbox"
                      name="columns"
                      value={column.key}
                      defaultChecked={column.defaultSelected !== false}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-500 dark:border-slate-700 dark:bg-slate-950"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        <GeneratedValue value={column.label} />
                      </span>
                      <GeneratedValue
                        value={
                          column.description ? (
                            <span className="mt-0.5 block truncate text-xs text-slate-400 dark:text-slate-500">
                              <GeneratedValue value={column.description} />
                            </span>
                          ) : null
                        }
                      />
                    </span>
                  </label>
                ))}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit">
              <Download size={14} />
              <GeneratedText id="m_1e0adf79cb22af" />
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}

async function loadBuilderAppExportEntities(ctx: RequestContext): Promise<ExportEntity[]> {
  if (!can(ctx, 'forms.response.read.self')) return []
  const effectiveRoleKeys = await getEffectiveRoleKeys(ctx)

  return ctx.db(async (tx) => {
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'forms.response',
      ownerCols: [formResponses.submittedBy],
      personCol: formResponses.subjectPersonId,
      siteCol: formResponses.siteOrgUnitId,
    })
    const filters: SQL<unknown>[] = [templateAccessWhere(ctx, effectiveRoleKeys, 'browse-records')]
    if (vis) filters.push(vis)

    const apps = await tx
      .select({
        id: formTemplates.id,
        name: formTemplates.name,
        category: formTemplates.category,
        kind: formTemplates.kind,
        responseCount: count(formResponses.id),
      })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .where(and(...filters))
      .groupBy(formTemplates.id, formTemplates.name, formTemplates.category, formTemplates.kind)
      .orderBy(desc(count(formResponses.id)), asc(formTemplates.name))

    if (apps.length === 0) return []

    const versionRows = await tx
      .select({
        templateId: formTemplateVersions.templateId,
        schema: formTemplateVersions.schema,
      })
      .from(formTemplateVersions)
      .where(
        inArray(
          formTemplateVersions.templateId,
          apps.map((app) => app.id),
        ),
      )
      .orderBy(asc(formTemplateVersions.version))

    const schemasByTemplate = new Map<string, FormSchemaV1[]>()
    for (const row of versionRows) {
      const schemas = schemasByTemplate.get(row.templateId) ?? []
      schemas.push(row.schema as FormSchemaV1)
      schemasByTemplate.set(row.templateId, schemas)
    }

    return apps.map((app) => {
      const responseCount = Number(app.responseCount ?? 0)
      const columns = buildResponseExportColumns(schemasByTemplate.get(app.id) ?? [])
      const fieldColumnCount = columns.filter((column) => column.source !== 'response').length
      const csvHref = buildHref('/apps/responses/export.csv', { template: app.id })
      return {
        key: `builder:${app.id}`,
        label: app.name,
        description: `${responseCount} visible response${
          responseCount === 1 ? '' : 's'
        } for this Builder app, including ${fieldColumnCount} app-specific data column${
          fieldColumnCount === 1 ? '' : 's'
        }.`,
        csvHref,
        formActionHref: '/apps/responses/export.csv',
        fixedParams: { template: app.id },
        sourceHref: buildHref('/apps/responses', { template: app.id }),
        groupLabel: 'Builder apps',
        ownerLabel: 'Builder',
        permissionAny: ['forms.response.read.self'],
        sensitivity: 'Sensitive' as const,
        defaultScope: 'Visible responses for this app',
        rowLimit: `10,000-row cap / ${responseCount} currently visible`,
        defaultSort: 'Submitted date, newest first',
        filterSummary: ['Status', 'Sort', `${columns.length} columns`],
        filters: [
          {
            kind: 'select' as const,
            name: 'status',
            label: 'Status',
            options: [...FORM_RESPONSE_STATUS_OPTIONS],
          },
        ],
        sortOptions: [
          { value: 'submitted_at', label: 'Submitted date' },
          { value: 'created_at', label: 'Created date' },
          { value: 'status', label: 'Status' },
        ],
        columns,
      }
    })
  })
}

function ExportFilterField({
  entityKey,
  filter,
}: {
  entityKey: string
  filter: ExportFilterControl
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const id = `${entityKey}-${filter.name}`
  if (filter.kind === 'text') {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>
          <GeneratedValue value={filter.label} />
        </Label>
        <Input id={id} name={filter.name} placeholder={tGeneratedValue(filter.placeholder)} />
      </div>
    )
  }
  if (filter.kind === 'date') {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>
          <GeneratedValue value={filter.label} />
        </Label>
        <Input id={id} name={filter.name} type="date" />
      </div>
    )
  }
  if (filter.kind === 'year') {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>
          <GeneratedValue value={filter.label} />
        </Label>
        <Input
          id={id}
          name={filter.name}
          type="number"
          min="2000"
          max="2100"
          defaultValue={filter.defaultValue}
        />
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        <GeneratedValue value={filter.label} />
      </Label>
      <Select
        id={id}
        name={filter.name}
        placeholder={tGeneratedValue(filter.emptyLabel ?? tGenerated('m_1ec3617d2cde86'))}
      >
        <option value="">{filter.emptyLabel ?? 'Any'}</option>
        {filter.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  )
}

function DrawerFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
        <GeneratedValue value={label} />
      </dt>
      <dd className="mt-1 text-slate-900 dark:text-slate-100">
        <GeneratedValue value={value} />
      </dd>
    </div>
  )
}
